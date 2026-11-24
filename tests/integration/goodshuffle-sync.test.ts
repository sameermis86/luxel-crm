import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leads, leadEvents } from "@/db/schema";
import { createLead } from "@/server/leads/service";
import { runGoodshuffleSync, getGsState, setGsAutoApply, setGsCreateLeads } from "@/server/integrations/goodshuffle";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
const NOW = new Date("2026-11-24T15:00:00Z");
const ev = (uid: string, date: string, summary: string, description = "") =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`, `SUMMARY:${summary}`, ...(description ? [`DESCRIPTION:${description}`] : []), "END:VEVENT"].join("\r\n");
const cal = (...evs: string[]) => ["BEGIN:VCALENDAR", ...evs, "END:VCALENDAR"].join("\r\n");
const feeds: Record<string, string> = {
  "https://cal/quote": cal(ev("q1", "2027-06-12", "Rossi Wedding"), ev("q2", "2027-08-01", "Park Wedding", "Status: Quote Sent\\nProject: Park Wedding (123456789)\\nVenue: Kortright Centre\\nClient: Mina Park\\nPhone #: (416) 555-0177")),
  "https://cal/signed": cal(ev("s1", "2027-09-18", "Nguyen Wedding"), ev("s2", "2027-06-12", "Rossi Wedding"), ev("s3", "2026-09-05", "Old Wedding", "Project: Old Wedding (555000111)\\nClient: Past Client")),
};
const calendars = { quote_sent: "https://cal/quote", signed: "https://cal/signed" } as const;
const fetcher = async (u: string) => feeds[u];

let rossi: string, nguyen: string;
beforeAll(async () => {
  env = await freshOrg();
  rossi = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Sofia", lastName: "Rossi", email: "sofia@example.com", eventType: "wedding", eventDate: "2027-06-12", status: "contacted" }))).id;
  nguyen = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Hannah", lastName: "Nguyen", email: "hannah@example.com", eventType: "wedding", eventDate: "2027-09-18" }))).id;
});
afterAll(closeDb);

describe("Goodshuffle sync", () => {
  it("lead creation is off until switched on", async () => {
    const s = await runGoodshuffleSync(env.orgId, { calendars, fetcher, now: NOW });
    expect(s.created).toBe(0);
    expect(s.unmatched!.map((u) => u.uid).sort()).toEqual(["q2", "s3"]);
  });

  it("preview (default) records proposed changes and unmatched projects without touching leads", async () => {
    await setGsCreateLeads(env.orgId, true);
    const s = await runGoodshuffleSync(env.orgId, { calendars, fetcher, now: NOW });
    expect(s.mode).toBe("preview");
    // Rossi is in both calendars: the furthest status (Signed) wins
    expect(s.changes!.map((c) => [c.leadId, c.to, c.applied]).sort()).toEqual([[nguyen, "won", false], [rossi, "won", false]].sort());
    // a Goodshuffle project with no lead becomes one (source Goodshuffle), at its stage, even in preview
    // …but only for upcoming events: the past project stays in the review list
    expect(s.unmatched!.map((u) => u.uid)).toEqual(["s3"]);
    expect(s.created).toBe(1);
    const [park] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.goodshuffleProject, "123456789")));
    expect(park).toMatchObject({ firstName: "Mina", lastName: "Park", source: "goodshuffle", captureChannel: "goodshuffle", status: "proposal_sent", goodshuffleStatus: "quote_sent", venueName: "Kortright Centre", phoneE164: "+14165550177", eventDate: "2027-08-01" });
    // matched leads get the Goodshuffle stage tag, without their CRM status changing yet
    const [r] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, rossi)));
    expect(r.goodshuffleStatus).toBe("signed");
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, rossi)));
    expect(l.status).toBe("contacted");
    expect((await getGsState(env.orgId)).changes!.length).toBe(2);
  });

  it("onlyExact applies phone/email matches and leaves name matches pending", async () => {
    const s = await runGoodshuffleSync(env.orgId, { mode: "apply", onlyExact: true, calendars, fetcher, now: NOW });
    expect(s.changes!.every((c) => !c.applied)).toBe(true); // both test matches are date + name
  });

  it("apply moves leads forward through the audited path, tagged via goodshuffle", async () => {
    await setGsAutoApply(env.orgId, true);
    const s = await runGoodshuffleSync(env.orgId, { calendars, fetcher, now: NOW });
    expect(s.mode).toBe("apply");
    expect(s.changes!.every((c) => c.applied)).toBe(true);
    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, rossi)));
    expect(l.status).toBe("won");
    const [e] = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, rossi), eq(leadEvents.type, "status_changed"))));
    expect((e.payload as any).via).toBe("goodshuffle");
    expect(e.actorKind).toBe("system");
  });

  it("a second run changes nothing", async () => {
    const s = await runGoodshuffleSync(env.orgId, { calendars, fetcher, now: NOW });
    expect(s.changes).toEqual([]);
    expect(s.created).toBe(0); // the Park lead is found again by its project number
    expect(s.tagged).toBe(0);
    expect(s.alreadyInStep).toBe(3);
  });
});
