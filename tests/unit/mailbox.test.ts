import { describe, it, expect } from "vitest";
import { directionOf, participants, skipFolder, mailKey, type MailHeader } from "@/lib/mailbox";

const own = ["luxeldecor.com"];
const m = (over: Partial<MailHeader>): MailHeader => ({ folder: "INBOX", uid: 1, messageId: "<a@x>", date: new Date("2026-11-20T15:00:00Z"), subject: "Hi", from: [], to: [], cc: [], ...over });

describe("mailbox matching", () => {
  it("direction comes from the sender, not the folder", () => {
    expect(directionOf(m({ folder: "Clients/Rossi", from: ["info@luxeldecor.com"] }), own)).toBe("outbound");
    expect(directionOf(m({ folder: "Sent", from: ["sofia@gmail.com"] }), own)).toBe("inbound");
  });
  it("outbound: everyone it went to; inbound: the sender, plus clients copied", () => {
    expect(participants(m({ from: ["info@luxeldecor.com"], to: ["Sofia@Gmail.com", "mansi@luxeldecor.com"], cc: ["planner@co.ca"] }), own)).toEqual([
      { email: "sofia@gmail.com", role: "to" }, { email: "planner@co.ca", role: "to" },
    ]);
    expect(participants(m({ from: ["planner@co.ca"], to: ["info@luxeldecor.com"], cc: ["sofia@gmail.com"] }), own)).toEqual([
      { email: "planner@co.ca", role: "from" }, { email: "sofia@gmail.com", role: "cc" },
    ]);
    expect(participants(m({ from: ["sameer@luxeldecor.com"], to: ["info@luxeldecor.com"] }), own)).toEqual([]);
  });
  it("skips trash, spam and drafts; reads everything else", () => {
    expect(skipFolder("INBOX")).toBe(false);
    expect(skipFolder("INBOX.Clients.Rossi")).toBe(false);
    expect(skipFolder("Archive")).toBe(false);
    expect(skipFolder("INBOX.Trash")).toBe(true);
    expect(skipFolder("Junk E-mail")).toBe(true);
    expect(skipFolder("Drafts")).toBe(true);
    expect(skipFolder("Whatever", "\\Junk")).toBe(true);
  });
  it("keys messages by Message-ID, with a fallback", () => {
    expect(mailKey(m({}))).toBe("<a@x>");
    expect(mailKey(m({ messageId: null, uid: 7, folder: "Sent" }))).toBe("Sent:7:2026-11-20T15:00:00.000Z");
  });
});
