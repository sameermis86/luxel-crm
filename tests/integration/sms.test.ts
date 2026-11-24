import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads } from "@/db/schema";
import { createLead, logActivity, updateLead } from "@/server/leads/service";
import { reminderQueue as textQueue, lastTexts } from "@/server/sms";
import { getSettings } from "@/server/settings";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
const NOW = new Date();
let fresh: string, old: string, noPhone: string;

beforeAll(async () => {
  env = await freshOrg();
  const mk = (first: string, phone: string | null, createdAt?: Date) =>
    withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: first, lastName: "Test", phone, eventType: "wedding" }, { createdAt }));
  fresh = (await mk("Fresh", "416-555-0101", new Date(NOW.getTime() - 3 * 86_400_000))).id;
  old = (await mk("Old", "416-555-0102", new Date(NOW.getTime() - 300 * 86_400_000))).id;
  noPhone = (await mk("NoPhone", null)).id;
});
afterAll(closeDb);

describe("text reminders", () => {
  it("queues only leads awaiting follow-up that we may text, and says why others are left out", async () => {
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const q = await withCtx(env.sys, (tx) => textQueue(tx, NOW, settings));
    expect(q.rows.map((r) => r.id)).toEqual([fresh]);
    expect(Object.values(q.skipped).reduce((a, b) => a + b, 0)).toBe(1); // old: out of consent; noPhone isn't a candidate
    expect(q.rows.some((r) => r.id === noPhone || r.id === old)).toBe(false);
  });

  it("a logged text counts as contact, is remembered, and holds the lead out of the queue for a few days; STOP removes it", async () => {
    await withCtx(env.sys, (tx) => logActivity(tx, env.sys, fresh, { kind: "text", direction: "outbound", summary: "Hi Fresh… Reply STOP to opt out." }));
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, fresh)));
    expect(l.status).toBe("contacted");
    expect(l.lastContactedAt).toBeTruthy();
    expect((await withCtx(env.sys, (tx) => lastTexts(tx, [fresh]))).get(fresh)).toBeInstanceOf(Date);

    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const later = new Date(NOW.getTime() + 4 * 86_400_000);
    // still awaiting (no follow-up set in this test), texted 4 days ago: back in the queue
    expect((await withCtx(env.sys, (tx) => textQueue(tx, later, settings))).rows.map((r) => r.id)).toEqual([fresh]);
    await withCtx(env.sys, (tx) => updateLead(tx, env.sys, fresh, { smsOptOutAt: NOW }));
    expect((await withCtx(env.sys, (tx) => textQueue(tx, later, settings))).rows).toEqual([]);
  });
});
