import { describe, it, expect } from "vitest";
import { counterparts, mailKey, type MailHeader } from "@/lib/mailbox";

const m = (over: Partial<MailHeader>): MailHeader => ({ folder: "sent", uid: 1, messageId: "<a@x>", date: new Date("2026-11-20T15:00:00Z"), subject: "Hi", from: [], to: [], cc: [], ...over });

describe("mailbox counterparts", () => {
  it("sent mail: everyone it went to, minus our own domain", () => {
    expect(counterparts(m({ from: ["info@luxeldecor.com"], to: ["Sofia@Gmail.com", "mansi@luxeldecor.com"], cc: ["planner@co.ca"] }), ["luxeldecor.com"])).toEqual(["sofia@gmail.com", "planner@co.ca"]);
  });
  it("received mail: who sent it", () => {
    expect(counterparts(m({ folder: "inbox", from: ["sofia@gmail.com"], to: ["info@luxeldecor.com"] }), ["@luxeldecor.com"])).toEqual(["sofia@gmail.com"]);
    expect(counterparts(m({ folder: "inbox", from: ["sameer@luxeldecor.com"] }), ["luxeldecor.com"])).toEqual([]);
  });
  it("keys messages by Message-ID, with a fallback", () => {
    expect(mailKey(m({}))).toBe("<a@x>");
    expect(mailKey(m({ messageId: null, uid: 7 }))).toBe("sent:7:2026-11-20T15:00:00.000Z");
  });
});
