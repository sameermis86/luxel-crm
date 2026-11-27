import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withCtx, systemCtx, type Tx } from "@/db/client";
import { followUps, integrationState, leadEvents, leads } from "@/db/schema";
import { directionOf, mailKey, participants, skipFolder, type MailHeader } from "@/lib/mailbox";
import { isExcludedContact } from "@/lib/setmore";
import { suggestNextFollowUp } from "@/lib/business-hours";
import { getSettings } from "@/server/settings";
import { logActivity, setFollowUp, LeadError } from "@/server/leads/service";
import { audit } from "@/server/audit";

/**
 * Mailbox (info@luxeldecor.com, IMAP) → lead timelines. Reads headers only (from, to, cc, date, subject)
 * of every folder except trash, spam and drafts. Direction comes from the sender: from our domain is an
 * email we sent (counts as contact, closes follow-ups that were due by then); from a client is a reply
 * (counts as contact, keeps the follow-up open: they're waiting on us); a client copied on someone else's
 * email to us is logged as copied. Never sends, moves or deletes mail. Each message is logged once per lead
 * (by Message-ID, so the same email in two folders counts once). Each run that changes anything is in the
 * audit log; every change on a lead is in its timeline, tagged via: "mailbox".
 */

const STATE_KEY = "mailbox_sync";

export interface MailClient {
  /** folders on the account (path, and IMAP special-use flag if any) */
  folders(): Promise<{ path: string; specialUse?: string | null }[]>;
  /** up to `limit` messages in a folder with uid > afterUid (or since `since` on the first run), oldest first; `more` if some were left */
  fetch(folder: string, opts: { afterUid: number | null; since: Date; uidValidity: string | null; limit: number }): Promise<{ uidValidity: string; messages: MailHeader[]; more?: boolean }>;
  close(): Promise<void>;
}

export interface MailboxState {
  lastRunAt?: string;
  lastError?: string | null;
  /** per folder path: where reading got to */
  folders?: Record<string, { uidValidity: string; lastUid: number }>;
  foldersRead?: number;
  read?: number;
  logged?: number;
  leadsReached?: number;
  movedToContacted?: number;
  followUpsClosed?: number;
  /** a backlog is still being read (first run, or a newly added folder) */
  catchingUp?: boolean;
}

export function mailboxConfigured(env: Record<string, string | undefined> = process.env) {
  return !!(env.MAILBOX_IMAP_USER?.trim() && env.MAILBOX_IMAP_PASSWORD);
}

export async function getMailboxState(orgId: string): Promise<MailboxState> {
  const [row] = await withCtx(systemCtx(orgId), (tx) =>
    tx.select().from(integrationState).where(and(eq(integrationState.orgId, orgId), eq(integrationState.key, STATE_KEY))),
  );
  return (row?.value as MailboxState) ?? {};
}
async function saveState(orgId: string, value: MailboxState) {
  await withCtx(systemCtx(orgId), (tx) =>
    tx
      .insert(integrationState)
      .values({ orgId, key: STATE_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [integrationState.orgId, integrationState.key], set: { value, updatedAt: new Date() } }),
  );
}

/** IMAP client (imapflow). Host defaults to mail.<domain of the user>. */
export async function imapClient(env: Record<string, string | undefined> = process.env): Promise<MailClient> {
  const { ImapFlow } = await import("imapflow");
  const user = env.MAILBOX_IMAP_USER!.trim();
  const host = env.MAILBOX_IMAP_HOST?.trim() || `mail.${user.split("@")[1]}`;
  const client = new ImapFlow({ host, port: Number(env.MAILBOX_IMAP_PORT || 993), secure: true, auth: { user, pass: env.MAILBOX_IMAP_PASSWORD! }, logger: false });
  await client.connect();
  const addr = (list?: { address?: string }[]) => (list ?? []).map((a) => a.address ?? "").filter(Boolean);
  return {
    async folders() {
      const boxes = await client.list();
      return boxes.filter((b) => !b.flags?.has("\\Noselect")).map((b) => ({ path: b.path, specialUse: b.specialUse ?? null }));
    },
    async fetch(folder, { afterUid, since, uidValidity, limit }) {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const box = client.mailbox as { uidValidity?: bigint | number };
        const validity = String(box.uidValidity ?? "");
        const fresh = !afterUid || uidValidity !== validity; // uids reset: fall back to the date
        const found = ((fresh ? await client.search({ since }, { uid: true }) : await client.search({ uid: `${afterUid + 1}:*` }, { uid: true })) || [])
          .filter((u) => fresh || u > afterUid!) // "n:*" always includes the last message
          .sort((a, b) => a - b);
        const uids = found.slice(0, limit);
        const messages: MailHeader[] = [];
        if (!uids.length) return { uidValidity: validity, messages };
        for await (const m of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
          const e = m.envelope;
          messages.push({
            folder, uid: m.uid, messageId: e?.messageId ?? null, date: new Date((e?.date ?? m.internalDate ?? new Date()) as Date),
            subject: e?.subject ?? null, from: addr(e?.from), to: addr(e?.to), cc: addr(e?.cc),
          });
        }
        return { uidValidity: validity, messages: messages.sort((a, b) => a.uid - b.uid), more: found.length > uids.length };
      } finally {
        lock.release();
      }
    },
    close: () => client.logout().catch(() => undefined),
  };
}

export async function runMailboxSync(orgId: string, client: MailClient, opts: { now?: Date; ownDomains?: string[]; budgetMs?: number } = {}): Promise<MailboxState> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const outOfTime = () => !!opts.budgetMs && Date.now() - started > opts.budgetMs;
  const prev = await getMailboxState(orgId);
  const ctx = systemCtx(orgId);
  try {
    const settings = await withCtx(ctx, (tx) => getSettings(tx, orgId));
    const ownDomains = opts.ownDomains ?? [(process.env.MAILBOX_IMAP_USER ?? "").split("@")[1] ?? ""].filter(Boolean);
    const since = new Date(now.getTime() - settings.mailbox.backfillDays * 86_400_000);
    const boxes = (await client.folders()).filter((b) => !skipFolder(b.path, b.specialUse));

    // state from before every folder was read: "inbox" / "sent" → their real paths
    const folders = { ...(prev.folders ?? {}) };
    const sentPath = boxes.find((b) => b.specialUse === "\\Sent")?.path;
    if (folders.inbox && !folders.INBOX) folders.INBOX = folders.inbox;
    if (folders.sent && sentPath && !folders[sentPath]) folders[sentPath] = folders.sent;
    delete folders.inbox;
    delete folders.sent;

    // read every folder (half the time budget at most for reading, the rest for logging)
    const all: MailHeader[] = [];
    let catchingUp = false, foldersRead = 0;
    for (const b of boxes) {
      if (opts.budgetMs && Date.now() - started > opts.budgetMs / 2) { catchingUp = true; break; }
      const p = folders[b.path];
      const r = await client.fetch(b.path, { afterUid: p?.lastUid ?? null, since, uidValidity: p?.uidValidity ?? null, limit: settings.mailbox.batchSize });
      foldersRead++;
      if (r.more) catchingUp = true;
      all.push(...r.messages.filter((m) => m.date >= since));
      const last = r.messages.length ? Math.max(...r.messages.map((m) => m.uid)) : p && p.uidValidity === r.uidValidity ? p.lastUid : 0;
      folders[b.path] = { uidValidity: r.uidValidity, lastUid: last };
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime());

    // live leads by email; planners & partners aren't leads
    const pool = await withCtx(ctx, (tx) =>
      tx.select({ id: leads.id, email: leads.emailNormalized }).from(leads).where(and(isNull(leads.duplicateOfId), isNull(leads.archivedAt), sql`${leads.emailNormalized} is not null`)),
    );
    const byEmail = new Map(pool.filter((l) => !isExcludedContact(l.email, settings.setmore.excludeContacts)).map((l) => [l.email!, l.id]));

    let logged = 0, closed = 0, moved = 0, processed = 0;
    const reached = new Set<string>();
    for (let i = 0; i < all.length; i++, processed = i) {
      const m = all[i];
      if (outOfTime()) {
        // the next run starts again from the first message not done, per folder
        for (const f of new Set(all.slice(i).map((x) => x.folder))) {
          const left = all.slice(i).filter((x) => x.folder === f).map((x) => x.uid);
          folders[f] = { ...folders[f], lastUid: Math.min(...left) - 1 };
        }
        catchingUp = true;
        break;
      }
      const outbound = directionOf(m, ownDomains) === "outbound";
      const people = new Map<string, "to" | "from" | "cc">();
      for (const p of participants(m, ownDomains)) {
        const id = byEmail.get(p.email);
        if (id && !people.has(id)) people.set(id, p.role);
      }
      if (!people.size) continue;
      const key = mailKey(m);
      for (const [leadId, role] of people) {
        try {
          await withCtx(ctx, async (tx) => {
            if (await alreadyLogged(tx, leadId, key)) return;
            const [before] = await tx.select({ status: leads.status }).from(leads).where(eq(leads.id, leadId));
            const openBefore = await openFollowUpCount(tx, leadId);
            await logActivity(
              tx, ctx, leadId,
              { kind: "email", direction: outbound ? "outbound" : "inbound", summary: m.subject?.slice(0, 500) || "(no subject)", occurredAt: m.date },
              now,
              {
                // our email does the follow-up that was due by then; their reply keeps it open (they're waiting on us)
                closeDueBy: outbound ? new Date(m.date.getTime() + settings.mailbox.followUpGraceHours * 3600_000) : null,
                inboundCountsAsContact: role === "from",
                extraPayload: { via: "mailbox", messageId: key, role, folder: m.folder },
              },
            );
            const [after] = await tx.select({ status: leads.status }).from(leads).where(eq(leads.id, leadId));
            if (before?.status === "new" && after?.status === "contacted") moved++;
            const openAfter = await openFollowUpCount(tx, leadId);
            closed += Math.max(0, openBefore - openAfter);
            // an open lead we just emailed, with nothing planned: next follow-up from the email's date
            if (outbound && openAfter === 0 && after && !["won", "lost", "unqualified", "not_reachable"].includes(after.status)) {
              await setFollowUp(tx, ctx, leadId, { dueAt: suggestNextFollowUp(after.status, m.date, settings.followUps), note: "After email (from the mailbox)" }, now);
            }
            logged++;
            reached.add(leadId);
          });
        } catch (e) {
          if (!(e instanceof LeadError)) throw e; // read-only lead etc: skip
        }
      }
    }
    const state: MailboxState = {
      lastRunAt: now.toISOString(), lastError: null, folders, foldersRead, read: all.length, logged,
      leadsReached: reached.size, movedToContacted: moved, followUpsClosed: closed, catchingUp: catchingUp || all.length > processed,
    };
    await saveState(orgId, state);
    if (logged > 0) {
      await withCtx(ctx, (tx) =>
        audit(tx, ctx, "sync.mailbox", null, { emailsRead: all.length, emailsLogged: logged, leads: reached.size, movedToContacted: moved, followUpsClosed: closed, foldersRead }),
      );
    }
    return state;
  } catch (e) {
    await saveState(orgId, { ...prev, lastRunAt: now.toISOString(), lastError: (e as Error).message });
    throw e;
  } finally {
    await client.close();
  }
}

async function alreadyLogged(tx: Tx, leadId: string, key: string) {
  const r = await tx
    .select({ id: leadEvents.id })
    .from(leadEvents)
    .where(and(eq(leadEvents.leadId, leadId), inArray(leadEvents.type, ["email_logged"]), sql`${leadEvents.payload}->>'messageId' = ${key}`))
    .limit(1);
  return r.length > 0;
}
async function openFollowUpCount(tx: Tx, leadId: string) {
  const r = await tx.select({ n: sql<number>`count(*)::int` }).from(followUps).where(and(eq(followUps.leadId, leadId), isNull(followUps.doneAt)));
  return r[0]?.n ?? 0;
}

/**
 * One-off (cron `?mailbox=apply-replies`): emails clients sent us that were logged before replies
 * counted as contact. Leads still New with such an email (not a copy) become Contacted, through
 * updateLead, with last contacted = their latest email. Audited.
 */
export async function applyPastReplies(orgId: string, now = new Date()) {
  const ctx = systemCtx(orgId);
  const { updateLead } = await import("@/server/leads/service");
  const rows = await withCtx(ctx, (tx) =>
    tx
      .select({ leadId: leadEvents.leadId, at: sql<Date>`max((${leadEvents.payload}->>'occurredAt')::timestamptz)`.mapWith((v) => new Date(v)) })
      .from(leadEvents)
      .innerJoin(leads, eq(leads.id, leadEvents.leadId))
      .where(
        and(
          eq(leadEvents.type, "email_logged"),
          sql`${leadEvents.payload}->>'via' = 'mailbox' and ${leadEvents.payload}->>'direction' = 'inbound' and coalesce(${leadEvents.payload}->>'role', 'from') = 'from'`,
          eq(leads.status, "new"),
          isNull(leads.duplicateOfId),
          isNull(leads.archivedAt),
        ),
      )
      .groupBy(leadEvents.leadId),
  );
  let moved = 0;
  for (const r of rows) {
    try {
      await withCtx(ctx, (tx) => updateLead(tx, ctx, r.leadId, { status: "contacted", lastContactedAt: r.at }, { now, payload: { via: "mailbox", reason: "the client emailed us" } }));
      moved++;
    } catch (e) {
      if (!(e instanceof LeadError)) throw e;
    }
  }
  if (moved) await withCtx(ctx, (tx) => audit(tx, ctx, "sync.mailbox", null, { pastRepliesApplied: true, movedToContacted: moved }));
  return { moved };
}
