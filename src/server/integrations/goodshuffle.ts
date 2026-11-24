import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { withCtx, systemCtx } from "@/db/client";
import { integrationState, leads, type Status } from "@/db/schema";
import { dateInTz, addDaysToDate } from "@/lib/dates";
import { GS_ENV, GS_LABELS, GS_STATUSES, matchEvent, parseIcs, plannedStatus, type GsStatus } from "@/lib/goodshuffle";
import { updateLead, LeadError } from "@/server/leads/service";

/**
 * Goodshuffle Pro → CRM status sync, through Goodshuffle's Google Calendar sync.
 * Mode "preview" (default) only records what it would change; "apply" makes the changes.
 * Every applied change goes through updateLead (audited, rescored) tagged via: "goodshuffle".
 */

const STATE_KEY = "goodshuffle_sync";
const SETTINGS_KEY = "goodshuffle_settings";

export async function getGsSettings(orgId: string): Promise<{ autoApply: boolean }> {
  const [row] = await withCtx(systemCtx(orgId), (tx) =>
    tx.select().from(integrationState).where(and(eq(integrationState.orgId, orgId), eq(integrationState.key, SETTINGS_KEY))),
  );
  return { autoApply: !!(row?.value as { autoApply?: boolean } | undefined)?.autoApply };
}

export async function setGsAutoApply(orgId: string, autoApply: boolean) {
  await withCtx(systemCtx(orgId), (tx) =>
    tx
      .insert(integrationState)
      .values({ orgId, key: SETTINGS_KEY, value: { autoApply }, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [integrationState.orgId, integrationState.key], set: { value: { autoApply }, updatedAt: new Date() } }),
  );
}

/**
 * Shape of the configured calendars with all letters and digits masked, for checking
 * how Goodshuffle formats its events without exposing client details.
 */
export async function inspectCalendars(calendars = configuredCalendars(), fetcher: IcsFetcher = defaultFetcher) {
  const mask = (s: string) => s.replace(/\p{L}/gu, "x").replace(/\d/g, "9");
  const out: Record<string, unknown> = {};
  for (const [status, url] of Object.entries(calendars)) {
    const evs = parseIcs(await fetcher(url!));
    out[status] = {
      events: evs.length,
      withDate: evs.filter((e) => e.startDate).length,
      withEmailOrPhone: evs.filter((e) => /@|\d{3}[\s.-]?\d{4}/.test(e.summary + e.description)).length,
      samples: evs.slice(0, 4).map((e) => ({
        summary: mask(e.summary),
        descriptionLabels: [...new Set((e.description.match(/^[A-Za-z][A-Za-z ]{1,30}:/gm) ?? []).map((l) => l.trim()))],
        descriptionMasked: mask(e.description.slice(0, 240)),
        hasLocation: !!e.location,
      })),
    };
  }
  return out;
}

export interface GsChange {
  uid: string;
  gsStatus: GsStatus;
  eventDate: string | null;
  title: string;
  leadId: string;
  recordId: string;
  leadName: string;
  from: Status;
  to: Status;
  how: string;
  applied: boolean;
  error?: string;
}

export interface GsUnmatched {
  uid: string;
  gsStatus: GsStatus;
  eventDate: string | null;
  title: string;
  reason: string;
}

export interface GsState {
  mode?: "preview" | "apply";
  lastRunAt?: string;
  calendars?: GsStatus[];
  events?: number;
  changes?: GsChange[];
  unmatched?: GsUnmatched[];
  alreadyInStep?: number;
  lastError?: string | null;
}

export type IcsFetcher = (url: string) => Promise<string>;

export const defaultFetcher: IcsFetcher = async (url) => {
  const res = await fetch(url, { headers: { Accept: "text/calendar" } });
  if (!res.ok) throw new Error(`calendar fetch failed (${res.status})`);
  return res.text();
};

/** Which status calendars are configured (env var → iCal URL). */
export function configuredCalendars(env: Record<string, string | undefined> = process.env): Partial<Record<GsStatus, string>> {
  const out: Partial<Record<GsStatus, string>> = {};
  for (const s of GS_STATUSES) {
    const v = env[GS_ENV[s]]?.trim();
    if (v && /^(https|webcal):\/\//i.test(v)) out[s] = v.replace(/^webcal:/i, "https:");
  }
  return out;
}

export async function getGsState(orgId: string): Promise<GsState> {
  const [row] = await withCtx(systemCtx(orgId), (tx) =>
    tx.select().from(integrationState).where(and(eq(integrationState.orgId, orgId), eq(integrationState.key, STATE_KEY))),
  );
  return (row?.value as GsState) ?? {};
}

async function saveGsState(orgId: string, value: GsState) {
  await withCtx(systemCtx(orgId), (tx) =>
    tx
      .insert(integrationState)
      .values({ orgId, key: STATE_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [integrationState.orgId, integrationState.key], set: { value, updatedAt: new Date() } }),
  );
}

export async function runGoodshuffleSync(
  orgId: string,
  opts: { mode?: "preview" | "apply"; calendars?: Partial<Record<GsStatus, string>>; fetcher?: IcsFetcher; now?: Date } = {},
): Promise<GsState> {
  const now = opts.now ?? new Date();
  const mode = opts.mode ?? ((await getGsSettings(orgId)).autoApply ? "apply" : "preview");
  const calendars = opts.calendars ?? configuredCalendars();
  const fetcher = opts.fetcher ?? defaultFetcher;
  const statuses = Object.keys(calendars) as GsStatus[];
  if (!statuses.length) return { mode, calendars: [], lastError: "No Goodshuffle calendars configured" };

  const ctx = systemCtx(orgId);
  const since = addDaysToDate(dateInTz(now), -365);

  // live leads with what matching needs
  const pool = await withCtx(ctx, (tx) =>
    tx
      .select({
        id: leads.id, recordId: leads.recordId, firstName: leads.firstName, lastName: leads.lastName, partnerName: leads.partnerName,
        emailNormalized: leads.emailNormalized, phoneE164: leads.phoneE164, eventDate: leads.eventDate, status: leads.status,
      })
      .from(leads)
      .where(and(isNull(leads.duplicateOfId), isNull(leads.archivedAt), isNotNull(leads.id))),
  );
  const byId = new Map(pool.map((l) => [l.id, l]));

  const changes: GsChange[] = [];
  const unmatched: GsUnmatched[] = [];
  let events = 0;
  const inStep = new Set<string>(); // matched leads that are already at (or past) the Goodshuffle stage
  const seenLead = new Map<string, GsStatus>(); // a lead in several calendars: the furthest status wins

  const order: GsStatus[] = ["new", "quote_sent", "action_needed", "signed", "lost"];
  const fetched: { status: GsStatus; evs: ReturnType<typeof parseIcs> }[] = [];
  for (const status of statuses) {
    const text = await fetcher(calendars[status]!);
    fetched.push({ status, evs: parseIcs(text).filter((e) => !e.startDate || e.startDate >= since) });
  }
  fetched.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  for (const { status, evs } of fetched) {
    for (const ev of evs) {
      events++;
      const m = matchEvent(ev, pool);
      if (!m.leadId) {
        unmatched.push({ uid: ev.uid, gsStatus: status, eventDate: ev.startDate, title: ev.summary.slice(0, 120), reason: m.reason });
        continue;
      }
      const prior = seenLead.get(m.leadId);
      if (prior && order.indexOf(prior) > order.indexOf(status)) continue;
      seenLead.set(m.leadId, status);
      const lead = byId.get(m.leadId)!;
      const to = plannedStatus(lead.status, status);
      // replace an earlier planned change for the same lead (later calendars are further along)
      const idx = changes.findIndex((c) => c.leadId === m.leadId);
      if (idx >= 0) changes.splice(idx, 1);
      if (!to) {
        inStep.add(m.leadId);
        continue;
      }
      inStep.delete(m.leadId);
      changes.push({
        uid: ev.uid, gsStatus: status, eventDate: ev.startDate, title: ev.summary.slice(0, 120), leadId: lead.id, recordId: lead.recordId,
        leadName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "(no name)", from: lead.status, to, how: m.reason, applied: false,
      });
    }
  }

  if (mode === "apply") {
    for (const c of changes) {
      try {
        await withCtx(ctx, (tx) =>
          updateLead(
            tx,
            ctx,
            c.leadId,
            c.to === "lost" ? { status: "lost", lostReason: "other", lostReasonDetail: "Marked lost in Goodshuffle Pro" } : { status: c.to },
            { now, payload: { via: "goodshuffle", goodshuffleStatus: GS_LABELS[c.gsStatus], eventUid: c.uid, match: c.how } },
          ),
        );
        c.applied = true;
      } catch (e) {
        c.error = e instanceof LeadError ? e.message : String((e as Error)?.message ?? e);
      }
    }
  }

  const state: GsState = { mode, lastRunAt: now.toISOString(), calendars: statuses, events, changes, unmatched: unmatched.slice(0, 300), alreadyInStep: inStep.size, lastError: null };
  await saveGsState(orgId, state);
  return state;
}
