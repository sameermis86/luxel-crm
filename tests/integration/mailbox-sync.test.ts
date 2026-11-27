import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { auditLog, followUps, integrationState, leadEvents, leads, orgSettings } from "@/db/schema";
import { createLead, setFollowUp } from "@/server/leads/service";
import { runMailboxSync, getMailboxState, applyPastReplies, type MailClient } from "@/server/integrations/mailbox";
import { logActivity } from "@/server/leads/service";
import type { MailHeader } from "@/lib/mailbox";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
const NOW = new Date("2026-11-24T15:00:00Z");
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
const OWN = { now: NOW, ownDomains: ["luxeldecor.com"] };
let chased: string, early: string, quiet: string, replier: string, copied: string;

type Box = Record<string, MailHeader[]>;
const boxes: Box = { INBOX: [], "INBOX.Sent": [], "INBOX.Clients": [], "INBOX.Trash": [] };
const seen = { calls: [] as { folder: string; afterUid: number | null }[] };
const mailbox: MailClient = {
  async folders() { return [{ path: "INBOX" }, { path: "INBOX.Sent", specialUse: "\\Sent" }, { path: "INBOX.Clients" }, { path: "INBOX.Trash", specialUse: "\\Trash" }]; },
  async fetch(folder, { afterUid }) {
    seen.calls.push({ folder, afterUid });
    return { uidValidity: "1", messages: (boxes[folder] ?? []).filter((x) => afterUid == null || x.uid > afterUid) };
  },
  async close() {},
};
const ours = (folder: string, uid: number, date: Date, to: string[], subject = "Your event", cc: string[] = []): MailHeader =>
  ({ folder, uid, messageId: `<${folder}-${uid}@mail>`, date, subject, from: ["info@luxeldecor.com"], to, cc });
const theirs = (folder: string, uid: number, date: Date, from: string, cc: string[] = [], subject = "Re: something else"): MailHeader =>
  ({ folder, uid, messageId: `<${folder}-${uid}@mail>`, date, subject, from: [from], to: ["info@luxeldecor.com"], cc });

beforeAll(async () => {
  env = await freshOrg();
  const mk = (first: string, email: string) => withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: first, lastName: "Client", email, eventType: "wedding" }));
  chased = (await mk("Chased", "chased@gmail.com")).id;
  early = (await mk("Early", "early@gmail.com")).id;
  quiet = (await mk("Quiet", "quiet@gmail.com")).id;
  replier = (await mk("Replier", "replier@gmail.com")).id;
  copied = (await mk("Copied", "copied@gmail.com")).id;
  await withCtx(env.sys, async (tx) => {
    await setFollowUp(tx, env.sys, chased, { dueAt: day(-5) }, day(-10)); // emailed after it was due
    await setFollowUp(tx, env.sys, early, { dueAt: day(-1) }, day(-10)); // only emailed well before it was due
    await setFollowUp(tx, env.sys, replier, { dueAt: day(-1) }, day(-10)); // they wrote to us
  });
  // state from before every folder was read
  await withCtx(env.sys, (tx) => tx.insert(integrationState).values({ orgId: env.orgId, key: "mailbox_sync", value: { folders: {} } }));
});
afterAll(closeDb);

const open = (id: string) => withCtx(env.sys, (tx) => tx.select().from(followUps).where(and(eq(followUps.leadId, id), isNull(followUps.doneAt))));
const lead = async (id: string) => (await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, id))))[0];
const emails = (id: string) => withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, id), eq(leadEvents.type, "email_logged"))));

describe("mailbox sync: every folder, replies, copies, audit", () => {
  it("reads every folder but trash; direction comes from the sender; the same email in two folders counts once", async () => {
    boxes["INBOX.Sent"] = [ours("INBOX.Sent", 10, day(-3), ["Chased@Gmail.com"], "Re: quote"), ours("INBOX.Sent", 11, day(-9), ["early@gmail.com"])];
    // a sent copy filed in a client folder, and the very same message moved there too
    boxes["INBOX.Clients"] = [ours("INBOX.Clients", 1, day(-2), ["early@gmail.com"]), { ...ours("INBOX.Clients", 2, day(-3), ["chased@gmail.com"]), messageId: "<INBOX.Sent-10@mail>" }];
    boxes.INBOX = [theirs("INBOX", 5, day(-1), "replier@gmail.com", [], "Totally different subject"), theirs("INBOX", 6, day(-1), "planner@co.ca", ["copied@gmail.com"])];
    boxes["INBOX.Trash"] = [ours("INBOX.Trash", 1, day(-1), ["quiet@gmail.com"])];

    const s = await runMailboxSync(env.orgId, mailbox, OWN);
    expect(seen.calls.map((c) => c.folder)).toEqual(["INBOX", "INBOX.Sent", "INBOX.Clients"]); // no Trash
    expect(s).toMatchObject({ foldersRead: 3, logged: 5, lastError: null });

    expect((await emails(chased)).length).toBe(1); // same Message-ID in Sent and Clients
    expect((await emails(quiet)).length).toBe(0); // only in Trash
    expect((await lead(early)).status).toBe("contacted"); // a sent copy filed in a client folder counts
  });

  it("our email closes the follow-up that was due; a client's reply counts as contact but keeps the follow-up", async () => {
    expect((await open(chased)).map((f) => f.note)).toEqual(["After email (from the mailbox)"]);
    const r = await lead(replier);
    expect(r.status).toBe("contacted");
    expect(r.lastContactedAt?.toISOString()).toBe(day(-1).toISOString());
    expect((await open(replier)).map((f) => f.dueAt.toISOString())).toEqual([day(-1).toISOString()]); // still to do: they're waiting on us
    const ev = (await emails(replier))[0];
    expect(ev.payload).toMatchObject({ direction: "inbound", role: "from", via: "mailbox", folder: "INBOX" });
  });

  it("a client copied on someone else's email is logged as copied, without counting as contact", async () => {
    const c = await lead(copied);
    expect(c.status).toBe("new");
    expect((await emails(copied))[0].payload).toMatchObject({ direction: "inbound", role: "cc" });
  });

  it("is incremental per folder, and each run that changed something is in the audit log", async () => {
    seen.calls = [];
    expect((await runMailboxSync(env.orgId, mailbox, OWN)).logged).toBe(0);
    expect(seen.calls).toEqual([{ folder: "INBOX", afterUid: 6 }, { folder: "INBOX.Sent", afterUid: 11 }, { folder: "INBOX.Clients", afterUid: 2 }]);
    const runs = await withCtx(env.sys, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "sync.mailbox")));
    expect(runs.length).toBe(1); // the second run changed nothing
    expect(runs[0].metadata).toMatchObject({ emailsLogged: 5, movedToContacted: 3, foldersRead: 3 }); // chased, early, replier (copied stays New)
    expect(runs[0].actorUserId).toBeNull(); // the system did it
  });

  it("skips planners & partners, and resumes where it stopped when out of time", async () => {
    await withCtx(env.sys, (tx) => tx.insert(orgSettings).values({ orgId: env.orgId, settings: { setmore: { excludeContacts: ["quiet@gmail.com"] } } }).onConflictDoUpdate({ target: orgSettings.orgId, set: { settings: { setmore: { excludeContacts: ["quiet@gmail.com"] } } } }));
    boxes["INBOX.Sent"].push(ours("INBOX.Sent", 13, day(-1), ["quiet@gmail.com"]));
    expect((await runMailboxSync(env.orgId, mailbox, OWN)).logged).toBe(0);
    boxes.INBOX.push(theirs("INBOX", 7, day(-1), "early@gmail.com"));
    const t = await runMailboxSync(env.orgId, mailbox, { ...OWN, budgetMs: 1e9 });
    expect(t.logged).toBe(1);
    expect((await getMailboxState(env.orgId)).folders?.INBOX.lastUid).toBe(7);
  });

  it("one-off: leads still New that emailed us before the rule change become Contacted (copies don't count)", async () => {
    const mk = (first: string) => withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: first, lastName: "Old", email: `${first.toLowerCase()}@old.com`, eventType: "wedding" }));
    const wrote = (await mk("Wrote")).id, cc = (await mk("Cc")).id;
    await withCtx(env.sys, async (tx) => {
      // logged the old way: inbound, no contact, no role
      await logActivity(tx, env.sys, wrote, { kind: "email", direction: "inbound", summary: "Hi", occurredAt: day(-20) }, NOW, { closeDueBy: null, extraPayload: { via: "mailbox", messageId: "<old-1>" } });
      await logActivity(tx, env.sys, cc, { kind: "email", direction: "inbound", summary: "Hi", occurredAt: day(-20) }, NOW, { closeDueBy: null, extraPayload: { via: "mailbox", messageId: "<old-2>", role: "cc" } });
    });
    expect(await applyPastReplies(env.orgId, NOW)).toEqual({ moved: 1 });
    expect((await lead(wrote)).status).toBe("contacted");
    expect((await lead(wrote)).lastContactedAt?.toISOString()).toBe(day(-20).toISOString());
    expect((await lead(cc)).status).toBe("new");
    expect(await applyPastReplies(env.orgId, NOW)).toEqual({ moved: 0 });
  });
});
