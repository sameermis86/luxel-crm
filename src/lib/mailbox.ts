import { normalizeEmail } from "./normalize";

/** One email as the mailbox sync sees it: headers only, never the body. `folder` is the IMAP path. */
export interface MailHeader {
  folder: string;
  uid: number;
  messageId: string | null;
  date: Date;
  subject: string | null;
  from: string[];
  to: string[];
  cc: string[];
}

export type Direction = "outbound" | "inbound";
/** "to": we wrote to them; "from": they wrote to us; "cc": they were copied on someone else's email to us. */
export type Role = "to" | "from" | "cc";

const ownOf = (ownDomains: string[]) => ownDomains.map((d) => d.toLowerCase().replace(/^@/, "")).filter(Boolean);
const isOwn = (email: string, own: string[]) => own.some((d) => email.endsWith("@" + d));

/** Ours if it's from our own domain, wherever it's filed (a sent copy moved to a client folder is still outbound). */
export function directionOf(m: Pick<MailHeader, "from">, ownDomains: string[]): Direction {
  const own = ownOf(ownDomains);
  const sender = normalizeEmail(m.from[0] ?? "");
  return sender && isOwn(sender, own) ? "outbound" : "inbound";
}

/** The client addresses on a message and how each was involved. Our own domain is never a client. */
export function participants(m: MailHeader, ownDomains: string[]): { email: string; role: Role }[] {
  const own = ownOf(ownDomains);
  const out = new Map<string, Role>();
  const add = (list: string[], role: Role) => {
    for (const r of list) {
      const e = normalizeEmail(r);
      if (e && !isOwn(e, own) && !out.has(e)) out.set(e, role);
    }
  };
  if (directionOf(m, ownDomains) === "outbound") add([...m.to, ...m.cc], "to");
  else {
    add(m.from, "from");
    add([...m.to, ...m.cc], "cc");
  }
  return [...out].map(([email, role]) => ({ email, role }));
}

/** Folders never read: trash, spam, drafts, and "all mail" style duplicates. */
export function skipFolder(path: string, specialUse?: string | null): boolean {
  if (specialUse && ["\\Trash", "\\Junk", "\\Drafts", "\\All", "\\Archive_All"].includes(specialUse)) return true;
  const leaf = path.split(/[./]/).pop()!.toLowerCase();
  return /^(trash|deleted( items| messages)?|bin|spam|junk( e-?mail)?|bulk( mail)?|drafts?|templates|outbox|all mail)$/.test(leaf);
}

/** Stable id for de-duplication: the Message-ID header (the same email in two folders counts once), else folder + uid + time. */
export const mailKey = (m: MailHeader) => m.messageId?.trim() || `${m.folder}:${m.uid}:${m.date.toISOString()}`;
