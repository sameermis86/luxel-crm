import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { withCtx, systemCtx, type Tx } from "@/db/client";
import { appointments, integrationState, leads } from "@/db/schema";
import { bookingToRow, matchLead, type SmBooking, type SmCustomer, type SmNamed } from "@/lib/setmore";

/**
 * Setmore → CRM: copies appointments (60 days back, 120 ahead) into `appointments`
 * and links each to a lead by email/phone. Read-only on both sides: it never
 * changes Setmore, and it doesn't change lead statuses.
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
