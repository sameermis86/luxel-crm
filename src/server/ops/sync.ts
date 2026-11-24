import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { withCtx, systemCtx } from "@/db/client";
import { leads, opsEvents, opsItems, opsTasks } from "@/db/schema";
import { addDaysToDate, dateInTz } from "@/lib/dates";
import { parseIcs, type IcsEvent } from "@/lib/goodshuffle";
import { buildTasks, parseProject } from "@/lib/ops-parse";
import { configuredCalendars, defaultFetcher, type IcsFetcher } from "@/server/integrations/goodshuffle";
import { getSettings } from "@/server/settings";

/**
 * Goodshuffle signed contracts (Signed + Action needed calendars) → Ops board.
 * One ops_event per project number; its items become the pull sheet, and setup/teardown
 * tasks are generated per decor area. Re-running updates quantities and adds new lines,
 * and never touches what the team ticked off or added themselves.
 */
export async function runOpsSync(orgId: string, opts: { calendars?: ReturnType<typeof configuredCalendars>; fetcher?: IcsFetcher; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const calendars = opts.calendars ?? configuredCalendars();
  const fetcher = opts.fetcher ?? defaultFetcher;
  const ctx = systemCtx(orgId);
  const settings = await withCtx(ctx, (tx) => getSettings(tx, orgId));
  const from = addDaysToDate(dateInTz(now), -settings.ops.keepDaysAfter);

  // one entry per project (multi-day events appear once per day): earliest date wins
  const projects = new Map<string, { ev: IcsEvent; status: "signed" | "action_needed" }>();
  for (const status of ["signed", "action_needed"] as const) {
    if (!calendars[status]) continue;
    for (const ev of parseIcs(await fetcher(calendars[status]!))) {
      if (!ev.startDate || ev.startDate < from) continue;
      const p = parseProject(ev);
      const key = p.project ?? `uid:${ev.uid}`;
      const prev = projects.get(key);
      if (!prev || ev.startDate < prev.ev.startDate!) projects.set(key, { ev, status });
    }
  }

  let created = 0, updated = 0, itemsAdded = 0, tasksAdded = 0;
  const seen: string[] = [];
  await withCtx(ctx, async (tx) => {
    const leadByProject = new Map(
      (await tx.select({ id: leads.id, project: leads.goodshuffleProject }).from(leads).where(and(isNull(leads.duplicateOfId), inArray(leads.goodshuffleProject, [...projects.keys()].length ? [...projects.keys()] : ["-"]))))
        .map((l) => [l.project!, l.id]),
    );
    for (const [key, { ev, status }] of projects) {
      const p = parseProject(ev);
      seen.push(key);
      const values = {
        orgId, project: key, gsUid: ev.uid, gsStatus: status, leadId: leadByProject.get(key) ?? null,
        name: p.name, client: p.client, venue: p.venue, eventDate: ev.startDate!, timeText: p.timeText, salesLead: p.salesLead,
        notesInternal: p.notesInternal, notesClient: p.notesClient, links: p.links, goneAt: null, syncedAt: now,
      };
      const [existing] = await tx.select({ id: opsEvents.id }).from(opsEvents).where(and(eq(opsEvents.orgId, orgId), eq(opsEvents.project, key)));
      let eventId: string;
      if (existing) {
        await tx.update(opsEvents).set(values).where(eq(opsEvents.id, existing.id));
        eventId = existing.id;
        updated++;
      } else {
        [{ id: eventId }] = await tx.insert(opsEvents).values(values).returning({ id: opsEvents.id });
        created++;
      }

      // pull sheet: Goodshuffle lines, matched by area + name
      const lines = await tx.select().from(opsItems).where(and(eq(opsItems.eventId, eventId), eq(opsItems.fromGs, true)));
      const keyOf = (a: string, n: string) => `${a}\u0000${n}`;
      const byKey = new Map(lines.map((l) => [keyOf(l.area, l.name), l]));
      const current = new Set<string>();
      for (const it of p.items) {
        const k = keyOf(it.area, it.name);
        current.add(k);
        const row = byKey.get(k);
        if (!row) {
          await tx.insert(opsItems).values({ orgId, eventId, area: it.area, name: it.name, qty: it.qty, logistics: it.logistics, fromGs: true });
          itemsAdded++;
        } else if (row.qty !== it.qty || row.removedAt) {
          await tx.update(opsItems).set({ qty: it.qty, removedAt: null }).where(eq(opsItems.id, row.id));
        }
      }
      for (const l of lines) if (!current.has(keyOf(l.area, l.name)) && !l.removedAt) await tx.update(opsItems).set({ removedAt: now }).where(eq(opsItems.id, l.id));

      // checklist: generated tasks (unique per event/phase/area/title, so re-runs add only new ones)
      const tasks = buildTasks(p, { setup: settings.ops.setupSteps, teardown: settings.ops.teardownSteps });
      if (tasks.length) {
        const inserted = await tx
          .insert(opsTasks)
          .values(tasks.map((t, i) => ({ orgId, eventId, ...t, auto: true, sort: i })))
          .onConflictDoNothing()
          .returning({ id: opsTasks.id });
        tasksAdded += inserted.length;
      }
    }

    // upcoming events that left the signed calendars (cancelled / back to quote)
    const live = await tx.select({ id: opsEvents.id, project: opsEvents.project }).from(opsEvents).where(and(eq(opsEvents.orgId, orgId), gte(opsEvents.eventDate, dateInTz(now)), isNull(opsEvents.goneAt)));
    for (const e of live) if (!seen.includes(e.project)) await tx.update(opsEvents).set({ goneAt: now }).where(eq(opsEvents.id, e.id));
  });
  return { projects: projects.size, created, updated, itemsAdded, tasksAdded };
}
