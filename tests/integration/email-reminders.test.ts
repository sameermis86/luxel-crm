import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { withCtx, closeDb } from "@/db/client";
import { leadEvents, leads } from "@/db/schema";
import { createLead, updateLead } from "@/server/leads/service";
import { sendReminderEmail, type MailTransport, type OutgoingMail } from "@/server/email-reminders";
import { runMailboxSync, type MailClient } from "@/server/integrations/mailbox";
import { reminderQueue } from "@/server/sms";
import { getSettings } from "@/server/settings";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
let sofia: string;
const sent: OutgoingMail[] = [];
const saved: Buffer[] = [];
const transport: MailTransport = {
  async send(m) { sent.push(m); return { messageId: "<crm-1@luxeldecor.com>", raw: Buffer.from("raw") }; },
  async saveToSent(raw) { saved.push(raw); },
};

beforeAll(async () => {
  process.env.MAILBOX_IMAP_USER = "info@luxeldecor.com";
  process.env.UNSUBSCRIBE_SECRET = "test-secret-at-least-16-chars";
  process.env.APP_URL = "https://crm.example";
  env = await freshOrg();
  sofia = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Sofia", lastName: "Rossi", email: "sofia@gmail.com", eventType: "wedding" }))).id;
});
afterAll(closeDb);

describe("reminder emails", () => {
  it("are offered in the queue, sent only through sendReminderEmail, logged once even when the mailbox sync sees the copy in Sent", async () => {
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const q = await withCtx(env.sys, (tx) => reminderQueue(tx, new Date(), settings));
    expect(q.rows.find((r) => r.id === sofia)).toMatchObject({ canEmail: true, canText: false });

    const r = await sendReminderEmail(env.sys, { leadId: sofia, subject: "Your wedding", body: "Hi Sofia,\n\nChecking in." }, transport);
    expect(r).toEqual({ messageId: "<crm-1@luxeldecor.com>", savedToSent: true });
    expect(sent[0]).toMatchObject({ to: "sofia@gmail.com", subject: "Your wedding", replyTo: "info@luxeldecor.com" });
    expect(sent[0].from).toContain("<info@luxeldecor.com>");
    expect(sent[0].text).toMatch(/Unsubscribe: https:\/\/crm\.example\/unsubscribe\/[\w-]+\.[\w-]+$/);
    expect(saved.length).toBe(1);

    const [l] = await withCtx(env.sys, (tx) => tx.select().from(leads).where(eq(leads.id, sofia)));
    expect(l.status).toBe("contacted");
    expect(l.nextFollowUpAt).toBeTruthy();

    // the mailbox sync later reads the same message from Sent: not logged twice
    const copy: MailClient = {
      async fetch(folder) {
        return { uidValidity: "1", messages: folder === "sent" ? [{ folder: "sent", uid: 1, messageId: "<crm-1@luxeldecor.com>", date: new Date(), subject: "Your wedding", from: ["info@luxeldecor.com"], to: ["sofia@gmail.com"], cc: [] }] : [] };
      },
      async close() {},
    };
    await runMailboxSync(env.orgId, copy, { ownDomains: ["luxeldecor.com"] });
    const evs = await withCtx(env.sys, (tx) => tx.select().from(leadEvents).where(and(eq(leadEvents.leadId, sofia), eq(leadEvents.type, "email_logged"))));
    expect(evs.length).toBe(1);
  });

  it("refuses unsubscribed leads, and a failed copy to Sent doesn't fail the send", async () => {
    const other = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Leo", lastName: "Park", email: "leo@gmail.com", eventType: "wedding" }))).id;
    const flaky: MailTransport = { ...transport, async saveToSent() { throw new Error("imap down"); } };
    expect((await sendReminderEmail(env.sys, { leadId: other, subject: "Hi", body: "Hello" }, flaky)).savedToSent).toBe(false);
    await withCtx(env.sys, (tx) => updateLead(tx, env.sys, other, { emailOptOutAt: new Date() }));
    await expect(sendReminderEmail(env.sys, { leadId: other, subject: "Hi", body: "Hello" }, transport)).rejects.toThrow(/Unsubscribed/);
  });
});
