import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withCtx, systemCtx, type Tx } from "@/db/client";
import { followUps, integrationState, leadEvents, leads } from "@/db/schema";
import { counterparts, mailKey, type MailHeader } from "@/lib/mailbox";
import { isExcludedContact } from "@/lib/setmore";
import { suggestNextFollowUp } from "@/lib/business-hours";
import { getSettings } from "@/server/settings";
import { logActivity, setFollowUp, LeadError } from "@/server/leads/service";

/**
 * Mailbox (info@luxeldecor.com, IMAP) → lead timelines. Reads headers only (from, to, cc, date,
 * subject) of Sent and Inbox. An email to a lead is logged as an outbound email (last contacted,
 * New → Contacted, closes follow-ups that were due by then); an email from a lead is logged as a
 * reply. Never sends, moves or deletes mail. Each message is logged once (by Message-ID).
 */

const STATE_KEY = "mailbox_sync";

export interface MailClient {
  /** up to `limit` messages in a folder with uid > afterUid (or since `since` on the first run), oldest first; `more` if some were left */
  fetch(folder: "sent" | "inbox", opts: { afterUid: number | null; since: Date; uidValidity: string | null; limit: number }): Promise<{ uidValidity: string; messages: MailHeader[]; more?: boolean }>;
  close(): Promise<void>;
}

export interface MailboxState {
  lastRunAt?: string;
  lastError?: string | null;
  folders?: Record<string, { uidValidity: string; lastUid: number }>;
  read?: number;
  logged?: number;
  leadsReached?: number;
  followUpsClosed?: number;
  /** a backlog is still being read (first run) */
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
  const boxes = await client.list();
  const sentPath = boxes.find((b) => b.specialUse === "\\Sent")?.path ?? boxes.find((b) => /^(inbox[./])?sent( (items|mail|messages))?$/i.test(b.path))?.path ?? "Sent";
  const addr = (list?: { address?: string }[]) => (list ?? []).map((a) => a.address ?? "").filter(Boolean);
  return {
    async fetch(folder, { afterUid, since, uidValidity, limit }) {
      const lock = await client.getMailboxLock(folder === "sent" ? sentPath : "INBOX", { readOnly: true });
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
  const prev = await getMailboxState(orgId);
  const ctx = systemCtx(orgId);
  try {
    const settings = await withCtx(ctx, (tx) => getSettings(tx, orgId));
    const ownDomains = opts.ownDomains ?? [(process.env.MAILBOX_IMAP_USER ?? "").split("@")[1] ?? ""].filter(Boolean);
    const since = new Date(now.getTime() - settings.mailbox.backfillDays * 86_400_000);
    const folders = { ...(prev.folders ?? {}) };

    const all: MailHeader[] = [];
    let catchingUp = false;
    for (const f of ["sent", "inbox"] as const) {
      const p = folders[f];
      const r = await client.fetch(f, { afterUid: p?.lastUid ?? null, since, uidValidity: p?.uidValidity ?? null, limit: settings.mailbox.batchSize });
      if (r.more) catchingUp = true;
      all.push(...r.messages.filter((m) => m.date >= since));
      const last = r.messages.length ? Math.max(...r.messages.map((m) => m.uid)) : p && p.uidValidity === r.uidValidity ? p.lastUid : 0;
      folders[f] = { uidValidity: r.uidValidity, lastUid: last };
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime());

    // live leads by email; planners & partners aren't leads
    const pool = await withCtx(ctx, (tx) =>
      tx.select({ id: leads.id, email: leads.emailNormalized }).from(leads).where(and(isNull(leads.duplicateOfId), isNull(leads.archivedAt), sql`${leads.emailNormalized} is not null`)),
    );
    const byEmail = new Map(pool.filter((l) => !isExcludedContact(l.email, settings.setmore.excludeContacts)).map((l) => [l.email!, l.id]));

    let logged = 0, closed = 0;
    const reached = new Set<string>();
    let processed = 0;
    for (let i = 0; i < all.length; i++, processed = i) {
      const m = all[i];
      if (opts.budgetMs && Date.now() - started > opts.budgetMs) {
        // out of time: the next run starts again from the first message not done, per folder
        for (const f of ["sent", "inbox"] as const) {
          const left = all.slice(i).filter((x) => x.folder === f).map((x) => x.uid);
          if (left.length) folders[f] = { ...folders[f], lastUid: Math.min(...left) - 1 };
        }
        break;
      }
      const leadIds = [...new Set(counterparts(m, ownDomains).map((e) => byEmail.get(e)).filter((x): x is string => !!x))];
      if (!leadIds.length) continue;
      const key = mailKey(m);
      for (const leadId of leadIds) {
        try {
          await withCtx(ctx, async (tx) => {
            if (await alreadyLogged(tx, leadId, key)) return;
            const outbound = m.folder === "sent";
            const before = await openFollowUpCount(tx, leadId);
            await logActivity(
              tx, ctx, leadId,
              { kind: "email", direction: outbound ? "outbound" : "inbound", summary: m.subject?.slice(0, 500) || "(no subject)", occurredAt: m.date },
              now,
              { closeDueBy: outbound ? new Date(m.date.getTime() + settings.mailbox.followUpGraceHours * 3600_000) : null, extraPayload: { via: "mailbox", messageId: key } },
            );
            const after = await openFollowUpCount(tx, leadId);
            closed += Math.max(0, before - after);
            // an open lead we just emailed, with nothing planned: next follow-up from the email's date
            if (outbound && after === 0) {
              const [l] = await tx.select({ status: leads.status }).from(leads).where(eq(leads.id, leadId));
              if (l && !["won", "lost", "unqualified", "not_reachable"].includes(l.status)) {
                await setFollowUp(tx, ctx, leadId, { dueAt: suggestNextFollowUp(l.status, m.date, settings.followUps), note: "After email (from the mailbox)" }, now);
              }
            }
            logged++;
            if (outbound) reached.add(leadId);
          });
        } catch (e) {
          if (!(e instanceof LeadError)) throw e; // read-only lead etc: skip
        }
      }
    }
    const state: MailboxState = {
      lastRunAt: now.toISOString(), lastError: null, folders, read: all.length, logged, leadsReached: reached.size, followUpsClosed: closed,
      catchingUp: catchingUp || all.length > processed,
    };
    await saveState(orgId, state);
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
