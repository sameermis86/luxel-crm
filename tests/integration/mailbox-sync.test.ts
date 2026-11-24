import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { followUps, leadEvents, leads } from "@/db/schema";
import { createLead, setFollowUp } from "@/server/leads/service";
import { runMailboxSync, getMailboxState, type MailClient } from "@/server/integrations/mailbox";
import type { MailHeader } from "@/lib/mailbox";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
const NOW = new Date("2026-11-24T15:00:00Z");
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
let chased: string, early: string, quiet: string;

function fakeMailbox(boxes: Record<"sent" | "inbox", MailHeader[]>, seen: { calls: { folder: string; afterUid: number | null }[] }): MailClient {
  return {
    async fetch(folder, { afterUid }) {
      seen.calls.push({ folder, afterUid });
      return { uidValidity: "1", messages: boxes[folder].filter((x) => afterUid == null || x.uid > afterUid) };
    },
    async close() {},
  };
}
const msg = (folder: "sent" | "inbox", uid: number, date: Date, who: string, subject = "Your event"): MailHeader => ({
  folder, uid, messageId: `<${folder}-${uid}@mail>`, date, subject,
  from: folder === "sent" ? ["info@luxeldecor.com"] : [who], to: folder === "sent" ? [who] : ["info@luxeldecor.com"], cc: [],
});

beforeAll(async () => {
  env = await freshOrg();
  const mk = (first: string, email: string) => withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: first, lastName: "Client", email, eventType: "wedding" }));
  chased = (await mk("Chased", "chased@gmail.com")).id;
  early = (await mk("Early", "early@gmail.com")).id;
  quiet = (await mk("Quiet", "quiet@gmail.com")).id;
  await withCtx(env.sys, async (tx) => {
    await setFollowUp(tx, env.sys, chased, { dueAt: day(-5) }, day(-10)); // overdue: emailed after it was due
    await setFollowUp(tx, env.sys, early, { dueAt: day(-1) }, day(-10)); // overdue: only emailed well before it was due
  });
});
afterAll(closeDb);

describe("mailbox sync", () => {
  const seen = { calls: [] as { folder: string; afterUid: number | null }[] };
  const boxes = {
    sent: [msg("sent", 10, day(-3), "Chased@Gmail.com", "Re: quote"), msg("sent", 11, day(-9), "early@gmail.com"), msg("sent", 12, day(-2), "stranger@gmail.com")],
    inbox: [msg("inbox", 5, day(-2), "chased@gmail.com", "Re: Re: quote"), msg("inbox", 6, day(-1), "mansi@luxeldecor.com")],
  };

  it("logs emails to and from leads, marks them contacted, and closes only the follow-ups the email did", async () => {
    const s = await runMailboxSync(env.orgId, fakeMailbox(boxes, seen), { now: NOW, ownDomains: ["luxeldecor.com"] });
    expect(s).toMatchObject({ logged: 3, leadsReached: 2, lastError: null });

    const all = await withCtx(env.sys, (tx) => tx.select().from(leads));
    const by = (id: string) => all.find((l) => l.id === id)!;
    expect(by(chased).status).toBe("contacted");
    expect(by(chased).lastContactedAt?.toISOString()).toBe(day(-3).toISOString());
    expect(by(early).status).toBe("contacted");
    expect(by(quiet).status).toBe("new");

    const open = async (id: string) => withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, id), isNull(followUps.doneAt))));
    // chased: the overdue follow-up is done, and the next one is planned from the email's date
    const c = await open(chased);
    expect(c.length).toBe(1);
    expect(c[0].note).toMatch(/After email/);
    // early: an email 8 days before the follow-up was due doesn't do it
    expect((await open(early)).map((f) => f.dueAt.toISOString())).toEqual([day(-1).toISOString()]);

    const evs = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, chased), eq(leadEvents.type, "email_logged"))));
    expect(evs.map((e) => (e.payload as any).direction).sort()).toEqual(["inbound", "outbound"]);
    expect(evs.every((e) => (e.payload as any).via === "mailbox")).toBe(true);
  });

  it("is incremental and logs each message once", async () => {
    seen.calls = [];
    const again = await runMailboxSync(env.orgId, fakeMailbox(boxes, seen), { now: NOW, ownDomains: ["luxeldecor.com"] });
    expect(again.logged).toBe(0);
    expect(seen.calls).toEqual([{ folder: "sent", afterUid: 12 }, { folder: "inbox", afterUid: 6 }]);
    expect((await getMailboxState(env.orgId)).folders).toEqual({ sent: { uidValidity: "1", lastUid: 12 }, inbox: { uidValidity: "1", lastUid: 6 } });
  });

  it("skips planners & partners, and resumes where it stopped when out of time", async () => {
    const { orgSettings } = await import("@/db/schema");
    await withCtx(env.sys, (tx) => tx.insert(orgSettings).values({ orgId: env.orgId, settings: { setmore: { excludeContacts: ["quiet@gmail.com"] } } }).onConflictDoUpdate({ target: orgSettings.orgId, set: { settings: { setmore: { excludeContacts: ["quiet@gmail.com"] } } } }));
    boxes.sent.push(msg("sent", 13, day(-1), "quiet@gmail.com"));
    const s = await runMailboxSync(env.orgId, fakeMailbox(boxes, seen), { now: NOW, ownDomains: ["luxeldecor.com"] });
    expect(s.logged).toBe(0);
    const [q] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, quiet)));
    expect(q.status).toBe("new");

    // out of time straight away: nothing is skipped, the next run starts from the first unread message
    boxes.inbox.push(msg("inbox", 7, day(-1), "early@gmail.com"));
    const t = await runMailboxSync(env.orgId, fakeMailbox(boxes, seen), { now: NOW, ownDomains: ["luxeldecor.com"], budgetMs: -1 });
    expect(t.logged).toBe(0);
    expect(t.folders?.inbox.lastUid).toBe(6);
    const u = await runMailboxSync(env.orgId, fakeMailbox(boxes, seen), { now: NOW, ownDomains: ["luxeldecor.com"] });
    expect(u.logged).toBe(1);
  });
});
