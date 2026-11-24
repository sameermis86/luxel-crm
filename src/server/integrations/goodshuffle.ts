import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { withCtx, systemCtx } from "@/db/client";
import { integrationState, leads, type Status } from "@/db/schema";
import { dateInTz, addDaysToDate } from "@/lib/dates";
import { GS_ENV, GS_LABELS, GS_STATUSES, GS_TO_CRM, clientName, extractContacts, matchEvent, parseIcs, plannedStatus, projectNumber, venueName, type GsStatus, type IcsEvent } from "@/lib/goodshuffle";
import { ingestLead } from "@/server/leads/intake";
import { updateLead, LeadError } from "@/server/leads/service";

/**
 * Goodshuffle Pro → CRM status sync, through Goodshuffle's Google Calendar sync.
 * Mode "preview" (default) only records what it would change; "apply" makes the changes.
 * Every applied change goes through updateLead (audited, requalified) tagged via: "goodshuffle".
 */

const STATE_KEY = "goodshuffle_sync";
const SETTINGS_KEY = "goodshuffle_settings";

export async function getGsSettings(orgId: string): Promise<{ autoApply: boolean; createLeads: boolean }> {
  const [row] = await withCtx(systemCtx(orgId), (tx) =>
    tx.select().from(integrationState).where(and(eq(integrationState.orgId, orgId), eq(integrationState.key, SETTINGS_KEY))),
  );
  const v = (row?.value ?? {}) as { autoApply?: boolean; createLeads?: boolean };
  return { autoApply: !!v.autoApply, createLeads: !!v.createLeads };
}

async function saveGsSettings(orgId: string, patch: Partial<{ autoApply: boolean; createLeads: boolean }>) {
  const value = { ...(await getGsSettings(orgId)), ...patch };
  await withCtx(systemCtx(orgId), (tx) =>
    tx
      .insert(integrationState)
      .values({ orgId, key: SETTINGS_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [integrationState.orgId, integrationState.key], set: { value, updatedAt: new Date() } }),
  );
}
export const setGsAutoApply = (orgId: string, autoApply: boolean) => saveGsSettings(orgId, { autoApply });
/** Create leads for Goodshuffle projects with no lead in the CRM (off until switched on). */
export const setGsCreateLeads = (orgId: string, createLeads: boolean) => saveGsSettings(orgId, { createLeads });

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
      withProjectNumber: evs.filter((e) => projectNumber(e)).length,
      createdByMonth: Object.entries(
        evs.reduce<Record<string, number>>((acc, e) => {
          const k = e.created ? e.created.toISOString().slice(0, 7) : "none";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
      ).sort(),
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
  /** leads created this run for Goodshuffle projects with no lead in the CRM */
  created?: number;
  /** leads whose Goodshuffle stage tag changed this run */
  tagged?: number;
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
  opts: { mode?: "preview" | "apply"; onlyExact?: boolean; createLeads?: boolean; calendars?: Partial<Record<GsStatus, string>>; fetcher?: IcsFetcher; now?: Date } = {},
): Promise<GsState> {
  const now = opts.now ?? new Date();
  const gsSettings = await getGsSettings(orgId);
  const mode = opts.mode ?? (gsSettings.autoApply ? "apply" : "preview");
  const createLeads = opts.createLeads ?? gsSettings.createLeads;
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
        goodshuffleProject: leads.goodshuffleProject, goodshuffleStatus: leads.goodshuffleStatus,
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

  // Goodshuffle stage tag per lead: the most decisive project wins (a signed job beats an older lost quote)
  const TAG_RANK: Record<GsStatus, number> = { new: 0, lost: 1, quote_sent: 2, action_needed: 3, signed: 4 };
  const tags = new Map<string, { status: GsStatus; project: string | null }>();
  const tag = (leadId: string, st: GsStatus, project: string | null) => {
    const prev = tags.get(leadId);
    if (!prev || TAG_RANK[st] > TAG_RANK[prev.status]) tags.set(leadId, { status: st, project: project ?? prev?.project ?? null });
  };
  const toCreate = new Map<string, { ev: IcsEvent; status: GsStatus }>(); // keyed by project number (or uid)
  const CREATABLE = new Set(["No lead with that event date", "No lead with a matching name on that date"]);

  for (const { status, evs } of fetched) {
    for (const ev of evs) {
      events++;
      const m = matchEvent(ev, pool);
      if (!m.leadId) {
        if (createLeads && CREATABLE.has(m.reason) && (clientName(ev) || ev.summary)) {
          const key = projectNumber(ev) ?? ev.uid;
          const prev = toCreate.get(key);
          if (!prev || TAG_RANK[status] > TAG_RANK[prev.status]) toCreate.set(key, { ev, status });
          continue;
        }
        unmatched.push({ uid: ev.uid, gsStatus: status, eventDate: ev.startDate, title: ev.summary.slice(0, 120), reason: m.reason });
        continue;
      }
      tag(m.leadId, status, projectNumber(ev));
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

  // Goodshuffle projects with no lead in the CRM become leads (source Goodshuffle), at their Goodshuffle stage
  let created = 0;
  for (const [key, { ev, status }] of toCreate) {
    const { emails, phones } = extractContacts(`${ev.summary}\n${ev.description}`);
    const crm = GS_TO_CRM[status] ?? "new";
    try {
      const r = await withCtx(ctx, (tx) =>
        ingestLead(
          tx,
          ctx,
          {
            fullName: clientName(ev) ?? ev.summary.slice(0, 120),
            email: emails[0] ?? null,
            phone: phones[0] ?? null,
            eventType: "wedding",
            eventDate: ev.startDate,
            venueName: venueName(ev),
            status: crm,
            ...(crm === "lost" ? { lostReason: "other" as const, lostReasonDetail: "Marked lost in Goodshuffle Pro" } : {}),
            message: `From Goodshuffle Pro: ${ev.summary.slice(0, 200)}`,
            explicitSource: "goodshuffle",
            explicitChannel: "goodshuffle",
          },
          { mode: "import", submissionId: `goodshuffle:${key}`, onDuplicate: "merge_blanks", autoAssign: false, autoFollowUp: false, createdAt: ev.created ?? undefined, now, rawPayload: { goodshuffleStatus: GS_LABELS[status], eventUid: ev.uid, project: projectNumber(ev) } },
        ),
      );
      if (r.lead) {
        if (r.outcome === "created") created++;
        tag(r.lead.id, status, projectNumber(ev));
        if (!byId.has(r.lead.id)) byId.set(r.lead.id, { ...r.lead, goodshuffleProject: null, goodshuffleStatus: null } as (typeof pool)[number]);
      }
    } catch (e) {
      unmatched.push({ uid: ev.uid, gsStatus: status, eventDate: ev.startDate, title: ev.summary.slice(0, 120), reason: `Couldn't create a lead: ${(e as Error).message}` });
    }
  }

  // stage tags: always written (they describe Goodshuffle, they don't change the CRM status)
  let tagged = 0;
  for (const [leadId, t] of tags) {
    const l = byId.get(leadId);
    if (!l || (l.goodshuffleStatus === t.status && (l.goodshuffleProject ?? null) === (t.project ?? l.goodshuffleProject ?? null))) continue;
    try {
      await withCtx(ctx, (tx) =>
        updateLead(tx, ctx, leadId, { goodshuffleStatus: t.status, goodshuffleProject: t.project ?? l.goodshuffleProject ?? null }, { now, allowReadOnly: true, payload: { via: "goodshuffle" } }),
      );
      tagged++;
    } catch {
      /* a lead merged meanwhile: its survivor gets tagged on the next run */
    }
  }

  if (mode === "apply") {
    for (const c of changes) {
      // onlyExact: apply phone/email matches; leave name-and-date matches for review
      if (opts.onlyExact && c.how !== "Same email or phone" && c.how !== "Same Goodshuffle project") continue;
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

  const state: GsState = { mode, lastRunAt: now.toISOString(), calendars: statuses, events, changes, unmatched: unmatched.slice(0, 300), alreadyInStep: inStep.size, created, tagged, lastError: null };
  await saveGsState(orgId, state);
  return state;
}
