import { and, eq, inArray, sql } from "drizzle-orm";
import { withCtx, type Ctx, type Tx } from "@/db/client";
import { leadEvents, leads } from "@/db/schema";
import { emailEligibility, emailFooter } from "@/lib/sms";
import { suggestNextFollowUp } from "@/lib/business-hours";
import { getSettings } from "@/server/settings";
import { logActivity, setFollowUp, LeadError } from "@/server/leads/service";
import { unsubscribeToken } from "@/server/unsubscribe";
import { appUrl } from "@/server/email";

/**
 * Reminder emails to clients, sent from the shared mailbox (info@) over SMTP when someone clicks
 * Send after reviewing the text. Never automatic. A copy is saved to the mailbox's Sent folder, and
 * the email is logged on the lead (the mailbox sync recognises it by Message-ID and won't log it twice).
 */

export interface OutgoingMail { from: string; to: string; subject: string; text: string; replyTo?: string }
export interface MailTransport {
  send(m: OutgoingMail): Promise<{ messageId: string; raw: Buffer }>;
  /** best effort: put a copy in the Sent folder so the team sees it in their mail app */
  saveToSent?(raw: Buffer): Promise<void>;
}

export function emailRemindersConfigured(env: Record<string, string | undefined> = process.env) {
  return !!(env.MAILBOX_IMAP_USER?.trim() && env.MAILBOX_IMAP_PASSWORD);
}

/** SMTP (nodemailer) + IMAP append, with the mailbox login. Host defaults to the IMAP host. */
export async function smtpTransport(env: Record<string, string | undefined> = process.env): Promise<MailTransport> {
  const nodemailer = (await import("nodemailer")).default;
  const user = env.MAILBOX_IMAP_USER!.trim();
  const host = env.MAILBOX_SMTP_HOST?.trim() || env.MAILBOX_IMAP_HOST?.trim() || `mail.${user.split("@")[1]}`;
  const port = Number(env.MAILBOX_SMTP_PORT || 465);
  const smtp = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass: env.MAILBOX_IMAP_PASSWORD! } });
  const build = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  return {
    async send(m) {
      // build once so the copy in Sent is byte-for-byte what was sent (same Message-ID)
      const built = await build.sendMail(m);
      const raw = built.message as Buffer;
      await smtp.sendMail({ envelope: { from: user, to: [m.to] }, raw });
      return { messageId: built.messageId, raw };
    },
    async saveToSent(raw) {
      const { ImapFlow } = await import("imapflow");
      const imap = new ImapFlow({ host: env.MAILBOX_IMAP_HOST?.trim() || `mail.${user.split("@")[1]}`, port: Number(env.MAILBOX_IMAP_PORT || 993), secure: true, auth: { user, pass: env.MAILBOX_IMAP_PASSWORD! }, logger: false });
      await imap.connect();
      try {
        const boxes = await imap.list();
        const sent = boxes.find((b) => b.specialUse === "\\Sent")?.path ?? "Sent";
        await imap.append(sent, raw, ["\\Seen"]);
      } finally {
        await imap.logout().catch(() => undefined);
      }
    },
  };
}

/** Latest reminder of either kind (text, or an email we sent: from the CRM or seen in Sent) per lead. */
export async function lastReminders(tx: Tx, leadIds: string[]): Promise<Map<string, Date>> {
  if (!leadIds.length) return new Map();
  const rows = await tx
    .select({ leadId: leadEvents.leadId, at: sql<Date>`max(coalesce((${leadEvents.payload}->>'occurredAt')::timestamptz, ${leadEvents.at}))`.mapWith((v) => new Date(v)) })
    .from(leadEvents)
    .where(
      and(
        inArray(leadEvents.leadId, leadIds),
        sql`(${leadEvents.type} = 'text_logged' or (${leadEvents.type} = 'email_logged' and ${leadEvents.payload}->>'direction' = 'outbound'))`,
      ),
    )
    .groupBy(leadEvents.leadId);
  return new Map(rows.map((r) => [r.leadId, r.at]));
}

/** Send one reviewed reminder email to a lead, then log it. */
export async function sendReminderEmail(ctx: Ctx, input: { leadId: string; subject: string; body: string }, transport: MailTransport, now = new Date()) {
  const { lead, settings } = await withCtx(ctx, async (tx) => {
    const [l] = await tx.select().from(leads).where(eq(leads.id, input.leadId));
    return { lead: l, settings: await getSettings(tx, ctx.orgId) };
  });
  if (!lead) throw new LeadError("Lead not found");
  // spacing is a guide for the queue; a person reviewing may send sooner
  const e = emailEligibility(lead, now, { ...settings.sms, minDaysBetween: 0 }, null);
  if (!e.ok) throw new LeadError(e.reason);

  const from = process.env.MAILBOX_IMAP_USER!.trim();
  const text = input.body.trim() + emailFooter({ senderName: settings.sms.senderName, signature: settings.emailReminders.signature, unsubscribeUrl: appUrl(`/unsubscribe/${unsubscribeToken(ctx.orgId, lead.id)}`) });
  const sent = await transport.send({ from: `"${settings.sms.senderName.replace(/"/g, "")}" <${from}>`, to: lead.email!, subject: input.subject.trim(), text, replyTo: from });
  let savedToSent = true;
  try {
    await transport.saveToSent?.(sent.raw);
  } catch (err) {
    savedToSent = false; // the client got it; only the copy in Sent is missing
    console.error("[reminder email] saving to Sent failed", err);
  }

  await withCtx(ctx, async (tx) => {
    const { lead: after } = await logActivity(tx, ctx, lead.id, { kind: "email", direction: "outbound", summary: input.subject.trim(), occurredAt: now }, now, {
      extraPayload: { via: "crm", messageId: sent.messageId },
    });
    if (!after.nextFollowUpAt && !["won", "lost", "unqualified", "not_reachable"].includes(after.status)) {
      await setFollowUp(tx, ctx, lead.id, { dueAt: suggestNextFollowUp(after.status, now, settings.followUps), note: "After reminder email" }, now);
    }
  });
  return { messageId: sent.messageId, savedToSent };
}
