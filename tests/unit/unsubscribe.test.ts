import { describe, it, expect, beforeAll } from "vitest";
import { readUnsubscribeToken, unsubscribeToken } from "@/server/unsubscribe";

const org = "11111111-1111-4111-8111-111111111111", lead = "22222222-2222-4222-8222-222222222222";
beforeAll(() => { process.env.UNSUBSCRIBE_SECRET = "test-secret-at-least-16-chars"; });

describe("unsubscribe tokens", () => {
  it("round-trips and rejects tampering", () => {
    const t = unsubscribeToken(org, lead);
    expect(readUnsubscribeToken(t)).toEqual({ orgId: org, leadId: lead });
    const [p, sig] = t.split(".");
    const other = Buffer.from(`${org}.33333333-3333-4333-8333-333333333333`).toString("base64url");
    expect(readUnsubscribeToken(`${other}.${sig}`)).toBeNull();
    expect(readUnsubscribeToken(`${p}.AAAA`)).toBeNull();
    expect(readUnsubscribeToken("garbage")).toBeNull();
  });
});
