import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { withCtx, systemCtx, type Ctx, type Tx } from "@/db/client";
import { appointments, followUps, integrationState, leads, orgSettings, type Status } from "@/db/schema";
import { bookingToRow, emailDomain, isExcludedContact, PUBLIC_EMAIL_DOMAINS, matchLead, matchLeadByName, plannedConsultStatus, statusForNewLead, type SmBooking, type SmCustomer, type SmNamed } from "@/lib/setmore";
import { updateLead, setFollowUp, completeFollowUp, LeadError } from "@/server/leads/service";
import { ingestLead } from "@/server/leads/intake";
import { getSettings } from "@/server/settings";

/**
 * Setmore → CRM: copies appointments (60 days back, 120 ahead) into `appointments`
 * and links each to a lead by email/phone. It never changes Setmore, and the sync
 * itself doesn't change lead statuses: `planConsultStatuses` previews forward-only
 * moves from the bookings and `applyConsultStatuses` makes them when an owner says so.
 */

const BASE = "https://developer.setmore.com/api/v2";
const STATE_KEY = "setmore_sync";
const WINDOW_DAYS = 30; // bookings are fetched in 30-day slices

export interface SetmoreClient {
  staff(): Promise<SmNamed[]>;
  services(): Promise<SmNamed[]>;
  bookings(staffId: string, startAt: string, endAt: string): Promise<SmBooking[]>;
  customer(id: string): Promise<SmCustomer | undefined>;
}

export function setmoreConfigured(env: Record<string, string | undefined> = process.env) {
  return !!env.SETMORE_REFRESH_TOKEN?.trim();
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z"); // whole seconds, as Setmore requires

export function setmoreRestClient(refreshToken: string, fetcher: typeof fetch = fetch): SetmoreClient {
  let token: string | null = null;
  const auth = async () => {
    if (token) return token;
    const r = await fetcher(`${BASE}/o/oauth2/token?refreshToken=${encodeURIComponent(refreshToken)}`);
    if (!r.ok) throw new Error(`Setmore token exchange failed (${r.status})`);
    const j = (await r.json()) as { data?: { token?: { access_token?: string } } };
    token = j.data?.token?.access_token ?? null;
    if (!token) throw new Error("Setmore token exchange returned no access token");
    return token;
  };
  const get = async <T>(path: string): Promise<{ data: T; cursor?: string }> => {
    const r = await fetcher(BASE + path, { headers: { Authorization: `Bearer ${await auth()}`, Accept: "application/json" } });
    if (r.status === 404) return { data: undefined as T };
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { errors?: { code?: string }[] };
      throw new Error(`Setmore ${path.split("?")[0]} failed (${r.status}${body.errors?.[0]?.code ? " " + body.errors[0].code : ""})`);
    }
    return (await r.json()) as { data: T; cursor?: string };
  };
  const all = async <T>(path: string): Promise<T[]> => {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const r = await get<T[]>(path + sep + "limit=100" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
      out.push(...(r.data ?? []));
      if (!r.cursor) break;
      cursor = r.cursor;
    }
    return out;
  };
  return {
    staff: () => all<SmNamed>("/staff"),
    services: () => all<SmNamed>("/services"),
    bookings: (staffId, startAt, endAt) =>
      all<SmBooking>(`/bookings/staffs/${encodeURIComponent(staffId)}?start_at=${encodeURIComponent(startAt)}&end_at=${encodeURIComponent(endAt)}`),
    customer: async (id) => (await get<SmCustomer>(`/customers/${encodeURIComponent(id)}`)).data,
  };
}

export interface SetmoreState {
  lastRunAt?: string;
  fetched?: number;
  upcoming?: number;
  matched?: number;
  unmatched?: number;
  lastError?: string | null;
}

export async function getSetmoreState(orgId: string): Promise<SetmoreState> {
  const [row] = await withCtx(systemCtx(orgId), (tx) =>
    tx.select().from(integrationState).where(and(eq(integrationState.orgId, orgId), eq(integrationState.key, STATE_KEY))),
  );
  return (row?.value as SetmoreState) ?? {};
}

async function saveState(orgId: string, value: SetmoreState) {
  await withCtx(systemCtx(orgId), (tx) =>
    tx
      .insert(integrationState)
      .values({ orgId, key: STATE_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [integrationState.orgId, integrationState.key], set: { value, updatedAt: new Date() } }),
  );
}

export async function runSetmoreSync(orgId: string, client: SetmoreClient, opts: { now?: Date } = {}): Promise<SetmoreState> {
  const now = opts.now ?? new Date();
  try {
    const [staff, services] = await Promise.all([client.staff(), client.services().catch(() => [] as SmNamed[])]);
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const serviceById = new Map(services.map((s) => [s.id, s]));

    // bookings for every staff member, in 30-day slices
    const from = new Date(now.getTime() - 60 * 86_400_000);
    const to = new Date(now.getTime() + 120 * 86_400_000);
    const bookings = new Map<string, SmBooking>();
    for (const s of staff) {
      for (let t = from.getTime(); t < to.getTime(); t += WINDOW_DAYS * 86_400_000) {
        const end = Math.min(t + WINDOW_DAYS * 86_400_000, to.getTime());
        for (const b of await client.bookings(s.id, iso(new Date(t)), iso(new Date(end)))) bookings.set(b.id, b);
      }
    }

    // customers already stored from earlier runs aren't fetched again (keeps the cron inside its time limit)
    const customers = new Map<string, SmCustomer | undefined>();
    const known = await withCtx(systemCtx(orgId), (tx) =>
      tx
        .select({ id: appointments.customerExternalId, name: appointments.customerName, email: appointments.email, phone: appointments.phoneE164 })
        .from(appointments)
        .where(and(eq(appointments.source, "setmore"), sql`${appointments.customerExternalId} is not null`)),
    );
    for (const k of known) {
      if (!k.id || customers.has(k.id)) continue;
      const [first, ...rest] = (k.name ?? "").split(" ");
      customers.set(k.id, {
        id: k.id,
        first_name: first || undefined,
        last_name: rest.join(" ") || undefined,
        email_addresses: k.email ? [{ value: k.email, primary: true }] : [],
        phone_numbers: k.phone ? [{ value: k.phone, primary: true }] : [],
      });
    }
    for (const b of bookings.values()) {
      const cid = b.consumer_ids?.[0];
      if (cid && !customers.has(cid)) customers.set(cid, await client.customer(cid));
    }

    const ctx = systemCtx(orgId);
    const pool = await withCtx(ctx, (tx) =>
      tx
        .select({ id: leads.id, emailNormalized: leads.emailNormalized, phoneE164: leads.phoneE164 })
        .from(leads)
        .where(and(isNull(leads.duplicateOfId), isNull(leads.archivedAt))),
    );

    let matched = 0, unmatched = 0, upcoming = 0, fetched = 0;
    await withCtx(ctx, async (tx) => {
      for (const b of bookings.values()) {
        const row = bookingToRow(b, customers.get(b.consumer_ids?.[0] ?? ""), serviceById.get(b.service_id ?? ""), staffById.get(b.provider_id ?? ""));
        if (!row) continue;
        fetched++;
        const leadId = matchLead(row, pool);
        if (leadId) matched++;
        else unmatched++;
        if (row.status === "confirmed" && row.startsAt >= now) upcoming++;
        await tx
          .insert(appointments)
          .values({ orgId, source: "setmore", ...row, leadId, syncedAt: now })
          .onConflictDoUpdate({
            target: [appointments.orgId, appointments.source, appointments.externalId],
            // keep a lead someone linked by hand ("Add as lead") if the automatic match finds none
            set: { ...row, leadId: sql`coalesce(${leadId}::uuid, ${appointments.leadId})`, syncedAt: now },
          });
      }
    });
    const state: SetmoreState = { lastRunAt: now.toISOString(), fetched, upcoming, matched, unmatched, lastError: null };
    await saveState(orgId, state);
    return state;
  } catch (e) {
    const state: SetmoreState = { ...(await getSetmoreState(orgId)), lastRunAt: now.toISOString(), lastError: (e as Error).message };
    await saveState(orgId, state);
    throw e;
  }
}

/** Appointments in [from, to) with their matched lead, soonest first (or latest first for past). */
export async function listAppointments(tx: Tx, from: Date, to: Date, order: "asc" | "desc", limit = 8) {
  return tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      status: appointments.status,
      customerName: appointments.customerName,
      email: appointments.email,
      emailNormalized: appointments.emailNormalized,
      serviceName: appointments.serviceName,
      staffName: appointments.staffName,
      leadId: appointments.leadId,
      recordId: leads.recordId,
      leadStatus: leads.status,
      leadFirst: leads.firstName,
      leadLast: leads.lastName,
    })
    .from(appointments)
    .leftJoin(leads, eq(leads.id, appointments.leadId))
    .where(and(gte(appointments.startsAt, from), lt(appointments.startsAt, to)))
    .orderBy(order === "asc" ? asc(appointments.startsAt) : desc(appointments.startsAt))
    .limit(limit);
}

export interface ConsultStatusChange {
  leadId: string;
  recordId: string;
  name: string;
  from: Status;
  to: Status;
  bookingAt: string;
}

/** Leads whose Setmore bookings support a forward move (see `plannedConsultStatus`). */
export async function planConsultStatuses(tx: Tx, now = new Date(), exclude: string[] = []): Promise<ConsultStatusChange[]> {
  const rows = await tx
    .select({
      leadId: leads.id,
      recordId: leads.recordId,
      first: leads.firstName,
      last: leads.lastName,
      status: leads.status,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      apptStatus: appointments.status,
      email: appointments.emailNormalized,
    })
    .from(appointments)
    .innerJoin(leads, eq(leads.id, appointments.leadId))
    .where(and(eq(appointments.source, "setmore"), isNull(leads.duplicateOfId), isNull(leads.archivedAt)));
  const byLead = new Map<string, typeof rows>();
  // planners' bookings never move a lead
  for (const r of rows) if (!isExcludedContact(r.email, exclude)) byLead.set(r.leadId, [...(byLead.get(r.leadId) ?? []), r]);
  const out: ConsultStatusChange[] = [];
  for (const [leadId, list] of byLead) {
    const l = list[0];
    const p = plannedConsultStatus(l.status, list.map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt, status: r.apptStatus })), now);
    if (p) out.push({ leadId, recordId: l.recordId, name: [l.first, l.last].filter(Boolean).join(" ") || "(no name)", from: l.status, to: p.to, bookingAt: p.startsAt.toISOString() });
  }
  return out.sort((a, b) => a.bookingAt.localeCompare(b.bookingAt));
}

/** Applies the current plan through updateLead (audited, tagged via: "setmore"). Re-plans inside, so it's never stale. */
export async function applyConsultStatuses(ctx: Ctx, now = new Date()) {
  const plan = await withCtx(ctx, async (tx) => planConsultStatuses(tx, now, (await getSettings(tx, ctx.orgId)).setmore.excludeContacts));
  let applied = 0;
  const errors: { recordId: string; error: string }[] = [];
  for (const c of plan) {
    try {
      await withCtx(ctx, (tx) => updateLead(tx, ctx, c.leadId, { status: c.to }, { now, payload: { via: "setmore", bookingAt: c.bookingAt } }));
      applied++;
    } catch (e) {
      errors.push({ recordId: c.recordId, error: e instanceof LeadError ? e.message : String((e as Error)?.message ?? e) });
    }
  }
  return { planned: plan.length, applied, errors };
}

const CLOSED: Status[] = ["won", "lost", "unqualified", "not_reachable"];

/**
 * Everything the scheduled sync does with bookings once they're stored:
 * 1. bookings with no lead: link to the one live lead with the same full name, otherwise create the lead
 *    (status by booking type, see statusForNewLead; dated at the first booking);
 * 2. move linked leads forward (applyConsultStatuses);
 * 3. a lead with a consultation ahead isn't waiting on a follow-up: overdue follow-ups are closed and the
 *    next one is set for the meeting itself (a follow-up someone set for later is left alone).
 */
export async function applyBookings(ctx: Ctx, now = new Date()) {
  const errors: { what: string; error: string }[] = [];
  const msg = (e: unknown) => (e instanceof LeadError ? e.message : String((e as Error)?.message ?? e));
  let linkedByName = 0, created = 0, followUpsMoved = 0;
  const settings = await withCtx(ctx, (tx) => getSettings(tx, ctx.orgId));

  // 1. unmatched bookings, grouped by person
  const loose = await withCtx(ctx, (tx) => tx.select().from(appointments).where(and(eq(appointments.source, "setmore"), isNull(appointments.leadId))));
  const people = new Map<string, typeof loose>();
  const exclude = settings.setmore.excludeContacts;
  for (const a of loose) {
    if (isExcludedContact(a.emailNormalized, exclude)) continue; // planners & partners aren't leads
    const key = a.emailNormalized ?? a.phoneE164 ?? a.customerExternalId ?? a.externalId;
    people.set(key, [...(people.get(key) ?? []), a]);
  }
  if (people.size) {
    const pool = await withCtx(ctx, (tx) =>
      tx.select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName }).from(leads).where(and(isNull(leads.duplicateOfId), isNull(leads.archivedAt))),
    );
    for (const [key, list] of people) {
      const first = [...list].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      const name = list.find((a) => a.customerName)?.customerName ?? null;
      try {
        await withCtx(ctx, async (tx) => {
          let leadId = matchLeadByName(name, pool);
          if (leadId) linkedByName++;
          else {
            const status = statusForNewLead(list, now, settings.setmore);
            if (!status) return; // only cancelled bookings: not a lead
            const when = first.startsAt.toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });
            const r = await ingestLead(
              tx,
              ctx,
              {
                fullName: name,
                email: list.find((a) => a.email)?.email ?? null,
                phone: list.find((a) => a.phoneE164)?.phoneE164 ?? null,
                status,
                message: `Booked in Setmore: ${list.map((a) => a.serviceName ?? "consultation").filter((v, i, all) => all.indexOf(v) === i).join(", ")} (first on ${when})`,
                explicitSource: "other",
                sourceDetail: "Setmore booking",
              },
              {
                mode: "import",
                submissionId: `setmore:${key}`,
                onDuplicate: "merge_blanks",
                autoFollowUp: false,
                createdAt: first.startsAt < now ? first.startsAt : now,
                now,
                settings,
                rawPayload: { form: "setmore", appointmentIds: list.map((a) => a.externalId) },
              },
            );
            if (!r.lead) return;
            leadId = r.lead.id;
            if (r.outcome === "created") created++;
          }
          await tx.update(appointments).set({ leadId }).where(inArray(appointments.id, list.map((a) => a.id)));
        });
      } catch (e) {
        errors.push({ what: `booking ${first.externalId}`, error: msg(e) });
      }
    }
  }

  // 2. forward-only status moves for linked leads
  const st = await applyConsultStatuses(ctx, now);
  errors.push(...st.errors.map((e) => ({ what: e.recordId, error: e.error })));

  // 3. a consultation ahead replaces an overdue (or missing) follow-up
  const aheadRows = await withCtx(ctx, (tx) =>
    tx
      .select({ leadId: appointments.leadId, startsAt: appointments.startsAt, email: appointments.emailNormalized, status: leads.status })
      .from(appointments)
      .innerJoin(leads, eq(leads.id, appointments.leadId))
      .where(and(eq(appointments.source, "setmore"), eq(appointments.status, "confirmed"), gt(appointments.startsAt, now), isNull(leads.duplicateOfId), isNull(leads.archivedAt))),
  );
  const soonest = new Map<string, { leadId: string; startsAt: Date; status: Status }>();
  for (const r of aheadRows) {
    if (!r.leadId || isExcludedContact(r.email, exclude)) continue;
    const cur = soonest.get(r.leadId);
    if (!cur || r.startsAt < cur.startsAt) soonest.set(r.leadId, { leadId: r.leadId, startsAt: r.startsAt, status: r.status });
  }
  for (const a of soonest.values()) {
    if (!a.leadId || CLOSED.includes(a.status)) continue;
    try {
      await withCtx(ctx, async (tx) => {
        const open = await tx.select().from(followUps).where(and(eq(followUps.leadId, a.leadId), isNull(followUps.doneAt)));
        const overdue = open.filter((f) => f.dueAt <= now);
        if (open.length > overdue.length) return; // someone already planned the next touch
        for (const f of overdue) await completeFollowUp(tx, ctx, f.id, now, { reason: "consultation booked in Setmore" });
        await setFollowUp(tx, ctx, a.leadId, { dueAt: a.startsAt, note: "Consultation booked in Setmore: follow up after the meeting" }, now);
        followUpsMoved++;
      });
    } catch (e) {
      errors.push({ what: `follow-up ${a.leadId}`, error: msg(e) });
    }
  }

  return { linkedByName, created, statusesApplied: st.applied, followUpsMoved, errors };
}

/**
 * One-off correction (cron `?setmore=undo-wins`): leads the booking sync created as Won before the
 * rule changed (bookings never make a lead Won). Only leads still Won from creation, with no
 * Goodshuffle stage and no status change by anyone since; they go to the stage their bookings show.
 */
export async function undoBookingWins(ctx: Ctx, now = new Date()) {
  const settings = await withCtx(ctx, (tx) => getSettings(tx, ctx.orgId));
  const candidates = await withCtx(ctx, (tx) =>
    tx
      .select({ id: leads.id, recordId: leads.recordId })
      .from(leads)
      .where(
        and(
          eq(leads.sourceDetail, "Setmore booking"),
          eq(leads.status, "won"),
          isNull(leads.goodshuffleStatus),
          isNull(leads.duplicateOfId),
          isNull(leads.archivedAt),
          sql`not exists (select 1 from lead_events e where e.lead_id = ${leads.id} and e.field = 'status')`,
        ),
      ),
  );
  const moved: { recordId: string; to: Status }[] = [];
  const errors: { recordId: string; error: string }[] = [];
  for (const c of candidates) {
    try {
      await withCtx(ctx, async (tx) => {
        const list = await tx.select().from(appointments).where(eq(appointments.leadId, c.id));
        const to = statusForNewLead(list, now, settings.setmore) ?? "consult_held";
        await updateLead(tx, ctx, c.id, { status: to }, { now, payload: { via: "setmore", reason: "Bookings don't make a lead Won; only a signed Goodshuffle contract does" } });
        moved.push({ recordId: c.recordId, to });
      });
    } catch (e) {
      errors.push({ recordId: c.recordId, error: e instanceof LeadError ? e.message : String((e as Error)?.message ?? e) });
    }
  }
  return { moved, errors };
}

/**
 * "Mark as planner": adds the email (or its company domain) to setmore.excludeContacts and archives
 * the lead it came from, plus any other lead the booking sync created for that contact. Owners only
 * (the caller authorizes). Archived leads drop out of follow-ups, the leads list and the dashboard.
 */
export async function markPlanner(ctx: Ctx, input: { email: string; scope: "email" | "domain"; leadId?: string | null }, now = new Date()) {
  const email = input.email.trim().toLowerCase();
  const domain = emailDomain(email);
  if (!domain) throw new LeadError("This contact has no email address");
  if (input.scope === "domain" && PUBLIC_EMAIL_DOMAINS.includes(domain)) throw new LeadError(`${domain} is a public email provider: mark the email instead`);
  const entry = input.scope === "domain" ? "@" + domain : email;

  return withCtx(ctx, async (tx) => {
    const settings = await getSettings(tx, ctx.orgId);
    const list = [...new Set([...settings.setmore.excludeContacts, entry])];
    const [row] = await tx.select().from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
    const stored = (row?.settings ?? {}) as Record<string, any>;
    const value = { ...stored, setmore: { ...(stored.setmore ?? {}), excludeContacts: list } };
    await tx
      .insert(orgSettings)
      .values({ orgId: ctx.orgId, settings: value, updatedBy: ctx.userId, updatedAt: now })
      .onConflictDoUpdate({ target: orgSettings.orgId, set: { settings: value, updatedBy: ctx.userId, updatedAt: now } });

    // the lead it was marked on, plus other leads the booking sync created for this contact
    const fromSync = await tx
      .select({ id: leads.id, email: leads.emailNormalized })
      .from(leads)
      .where(and(eq(leads.sourceDetail, "Setmore booking"), isNull(leads.archivedAt), isNull(leads.duplicateOfId)));
    const ids = new Set(fromSync.filter((l) => isExcludedContact(l.email, [entry])).map((l) => l.id));
    if (input.leadId) ids.add(input.leadId);
    let archived = 0;
    for (const id of ids) {
      const open = await tx.select({ id: followUps.id }).from(followUps).where(and(eq(followUps.leadId, id), isNull(followUps.doneAt)));
      for (const f of open) await completeFollowUp(tx, ctx, f.id, now, { reason: "marked as planner" });
      const r = await updateLead(tx, ctx, id, { archivedAt: now }, { now, payload: { via: "planner", entry } });
      if (r.changed.length) archived++;
    }
    return { entry, archived };
  });
}
