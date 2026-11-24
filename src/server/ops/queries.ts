import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { opsEvents, opsItems, opsTasks, users } from "@/db/schema";

/** Ops board: events in [from, to] with pull / setup / teardown progress. */
export async function listOpsEvents(tx: Tx, from: string, to: string) {
  return tx
    .select({
      id: opsEvents.id,
      name: opsEvents.name,
      client: opsEvents.client,
      venue: opsEvents.venue,
      eventDate: opsEvents.eventDate,
      timeText: opsEvents.timeText,
      gsStatus: opsEvents.gsStatus,
      goneAt: opsEvents.goneAt,
      items: sql<number>`(select count(*)::int from ops_items i where i.event_id = "ops_events"."id" and i.removed_at is null and not i.logistics)`,
      pulled: sql<number>`(select count(*)::int from ops_items i where i.event_id = "ops_events"."id" and i.removed_at is null and not i.logistics and i.pulled_at is not null)`,
      returned: sql<number>`(select count(*)::int from ops_items i where i.event_id = "ops_events"."id" and i.removed_at is null and not i.logistics and i.returned_at is not null)`,
      setupTotal: sql<number>`(select count(*)::int from ops_tasks t where t.event_id = "ops_events"."id" and t.phase = 'setup')`,
      setupDone: sql<number>`(select count(*)::int from ops_tasks t where t.event_id = "ops_events"."id" and t.phase = 'setup' and t.done_at is not null)`,
      teardownTotal: sql<number>`(select count(*)::int from ops_tasks t where t.event_id = "ops_events"."id" and t.phase = 'teardown')`,
      teardownDone: sql<number>`(select count(*)::int from ops_tasks t where t.event_id = "ops_events"."id" and t.phase = 'teardown' and t.done_at is not null)`,
    })
    .from(opsEvents)
    .where(and(gte(opsEvents.eventDate, from), lte(opsEvents.eventDate, to)))
    .orderBy(asc(opsEvents.eventDate), asc(opsEvents.name));
}

export async function getOpsEvent(tx: Tx, id: string) {
  const [event] = await tx.select().from(opsEvents).where(eq(opsEvents.id, id));
  if (!event) return null;
  const [items, tasks, people] = await Promise.all([
    tx.select().from(opsItems).where(eq(opsItems.eventId, id)).orderBy(asc(opsItems.createdAt)),
    tx.select().from(opsTasks).where(eq(opsTasks.eventId, id)).orderBy(asc(opsTasks.sort), asc(opsTasks.createdAt)),
    tx.select({ id: users.id, name: users.name }).from(users),
  ]);
  return { event, items, tasks, names: Object.fromEntries(people.map((u) => [u.id, u.name])) as Record<string, string> };
}
