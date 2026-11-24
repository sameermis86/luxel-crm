import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { opsEvents, opsItems, opsTasks } from "@/db/schema";
import { createLead, updateLead } from "@/server/leads/service";
import { runOpsSync } from "@/server/ops/sync";
import { listOpsEvents } from "@/server/ops/queries";
import { freshOrg } from "../helpers";
import { SAMPLE } from "../fixtures/goodshuffle-sample";

let env: Awaited<ReturnType<typeof freshOrg>>;
const NOW = new Date("2026-11-24T15:00:00Z");
const vevent = (uid: string, date: string, description: string) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`, "SUMMARY:Rossi Wedding", `DESCRIPTION:${description.replace(/\n/g, "\\n")}`, "END:VEVENT"].join("\r\n");
let feed = "";
const calendars = { signed: "https://cal/signed" } as const;
const fetcher = async () => feed;

beforeAll(async () => {
  env = await freshOrg();
  feed = ["BEGIN:VCALENDAR", vevent("e1", "2027-11-06", SAMPLE), vevent("e1b", "2027-11-07", SAMPLE), "END:VCALENDAR"].join("\r\n");
  const lead = await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Sofia", lastName: "Rossi", email: "sofia@example.com" }));
  await withCtx(env.sys, (tx) => updateLead(tx, env.sys, lead.id, { goodshuffleProject: "231716065", goodshuffleStatus: "signed" }));
});
afterAll(closeDb);

describe("Ops sync", () => {
  it("creates one event per project (multi-day entries merged), its pull sheet and checklist, linked to the lead", async () => {
    const r = await runOpsSync(env.orgId, { calendars, fetcher, now: NOW });
    expect(r).toMatchObject({ projects: 1, created: 1, itemsAdded: 6 });
    const [e] = await withCtx(env.sys, (tx) => tx.select().from(opsEvents));
    expect(e).toMatchObject({ project: "231716065", eventDate: "2027-11-06", venue: "Kortright Centre", gsStatus: "signed" });
    expect(e.leadId).toBeTruthy();
    const tasks = await withCtx(env.sys, (tx) => tx.select().from(opsTasks).where(eq(opsTasks.eventId, e.id)));
    // default template: 4 setup + 4 teardown steps × 3 decor areas, plus 3 logistics lines
    expect(tasks.length).toBe(4 * 3 + 4 * 3 + 3);
  });

  it("re-running keeps the team's ticks and components, updates quantities and flags removed lines", async () => {
    const [e] = await withCtx(env.sys, (tx) => tx.select().from(opsEvents));
    const [lobby] = await withCtx(env.sys, (tx) => tx.select().from(opsItems).where(and(eq(opsItems.eventId, e.id), eq(opsItems.area, "Lobby"))));
    await withCtx(env.sys, (tx) => tx.update(opsItems).set({ pulledAt: NOW }).where(eq(opsItems.id, lobby.id)));
    await withCtx(env.sys, (tx) => tx.insert(opsItems).values({ orgId: env.orgId, eventId: e.id, parentId: lobby.id, area: "Lobby", name: "Taper candles", qty: 6 }));
    feed = feed.replace("Set of 3 (Qty: 2)", "Set of 3 (Qty: 4)").replace(/Item: Guest Tables \(Qty: 1\)\\n/g, "");
    const r = await runOpsSync(env.orgId, { calendars, fetcher, now: NOW });
    expect(r).toMatchObject({ created: 0, updated: 1, itemsAdded: 0, tasksAdded: 0 });
    const items = await withCtx(env.sys, (tx) => tx.select().from(opsItems).where(eq(opsItems.eventId, e.id)));
    const l = items.find((i) => i.id === lobby.id)!;
    expect(l.qty).toBe(4);
    expect(l.pulledAt).toBeTruthy();
    expect(items.find((i) => i.name === "Taper candles")).toBeTruthy();
    expect(items.find((i) => i.name === "Guest Tables")!.removedAt).toBeTruthy();
  });

  it("the board shows progress; an event that leaves the signed calendar is flagged, not deleted", async () => {
    feed = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";
    await runOpsSync(env.orgId, { calendars, fetcher, now: NOW });
    const rows = await withCtx(env.sys, (tx) => listOpsEvents(tx, "2027-01-01", "2027-12-31"));
    expect(rows.length).toBe(1);
    expect(rows[0].goneAt).toBeTruthy();
    expect({ pulled: rows[0].pulled, items: rows[0].items, setup: rows[0].setupTotal }).toEqual({ pulled: 1, items: 3, setup: 14 });
    expect(rows[0].items).toBe(3); // Head table, Lobby, Taper candles (Guest Tables removed; logistics excluded)
  });
});
