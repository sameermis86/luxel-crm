import "server-only";
import { appUrl } from "./email";
import type { MailTransport } from "./email-reminders";

/**
 * Invites and admin-sent password resets, sent by the app itself (from the info@ mailbox).
 * Supabase admin links can't use the browser's PKCE code, so we ask Supabase for the one-time token
 * (generateLink) and link to /api/auth/confirm, which signs the person in and opens "Set your password".
 * The link works once and expires with Supabase's email OTP lifetime (1 hour).
 */
export type AccountLinkKind = "invite" | "recovery";

export async function sendAccountLink(
  admin: { auth: { admin: { generateLink(p: { type: AccountLinkKind; email: string }): Promise<{ data: { properties?: { hashed_token?: string } } | null; error: { message: string } | null }> } } },
  transport: MailTransport,
  o: { kind: AccountLinkKind; email: string; name: string; invitedBy: string; senderName: string },
): Promise<void> {
  const { data, error } = await admin.auth.admin.generateLink({ type: o.kind, email: o.email });
  if (error) throw new Error(error.message);
  const token = data?.properties?.hashed_token;
  if (!token) throw new Error("Supabase returned no link");
  const link = appUrl(`/api/auth/confirm?token_hash=${encodeURIComponent(token)}&type=${o.kind}&next=/account/password`);
  const first = o.name.split(" ")[0] || "there";
  const text =
    o.kind === "invite"
      ? `Hi ${first},\n\n${o.invitedBy} has invited you to the Luxel app, the back office for Luxel Decor & Flowers.\n\nSet your password here (the link works once and expires in 1 hour):\n${link}\n\nAfter that, sign in at ${appUrl("/login")} with this email address and your new password.\n\nIf you weren't expecting this, you can ignore this email.`
      : `Hi ${first},\n\n${o.invitedBy} sent you a link to set a new password for the Luxel app.\n\nSet your new password here (the link works once and expires in 1 hour):\n${link}\n\nIf you didn't ask for this, you can ignore this email; your current password keeps working.`;
  const from = process.env.MAILBOX_IMAP_USER!.trim();
  await transport.send({
    from: `"${o.senderName.replace(/"/g, "")}" <${from}>`,
    to: o.email,
    subject: o.kind === "invite" ? "You're invited to the Luxel app" : "Set a new password for the Luxel app",
    text,
  });
}
