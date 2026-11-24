import { normalizeEmail } from "./normalize";

/** One email as the mailbox sync sees it: headers only, never the body. */
export interface MailHeader {
  folder: "sent" | "inbox";
  uid: number;
  messageId: string | null;
  date: Date;
  subject: string | null;
  from: string[];
  to: string[];
  cc: string[];
}

/**
 * The client addresses on a message: for sent mail everyone it went to, for received mail who
 * sent it. Our own domains (luxeldecor.com …) are never a client.
 */
export function counterparts(m: MailHeader, ownDomains: string[]): string[] {
  const raw = m.folder === "sent" ? [...m.to, ...m.cc] : m.from;
  const own = ownDomains.map((d) => d.toLowerCase().replace(/^@/, ""));
  const out = new Set<string>();
  for (const r of raw) {
    const e = normalizeEmail(r);
    if (e && !own.some((d) => e.endsWith("@" + d))) out.add(e);
  }
  return [...out];
}

/** Stable id for de-duplication: the Message-ID header, else folder + uid + time. */
export const mailKey = (m: MailHeader) => m.messageId?.trim() || `${m.folder}:${m.uid}:${m.date.toISOString()}`;
