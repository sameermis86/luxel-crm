import { Resend } from "resend";

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/** Sent mail is kept in memory in dev/test so it can be inspected. */
export const sentEmails: EmailMessage[] = [];

export async function sendEmail(msg: EmailMessage) {
  const driver = process.env.EMAIL_DRIVER ?? "console";
  if (driver === "resend" && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "Luxel CRM <crm@luxeldecor.com>",
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) throw new Error(`Resend: ${error.message}`);
    return;
  }
  sentEmails.push(msg);
  if (driver !== "silent" && process.env.NODE_ENV !== "test") {
    console.log(`[email:console] to=${[msg.to].flat().join(",")} subject="${msg.subject}"`);
  }
}

/** Placeholder for SMS reminders (Twilio). Intentionally not implemented yet. */
export async function sendSms(_to: string, _body: string): Promise<void> {
  return;
}

export const appUrl = (path = "") => `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
