import { describe, it, expect, beforeAll } from "vitest";
import { signStamp, readStamp, stampState, IDLE_MS, MAX_MS, TOUCH_MS } from "@/lib/session-cookie";

beforeAll(() => { process.env.SESSION_SECRET = "test-session-secret-123456"; });

describe("session cookie", () => {
  it("round-trips and rejects tampering", async () => {
    const v = await signStamp({ uid: "u1", start: 1000, last: 2000 });
    expect(await readStamp(v)).toEqual({ uid: "u1", start: 1000, last: 2000 });
    const [body, sig] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "u2", start: 1000, last: 2000 })).toString("base64url");
    expect(await readStamp(`${forged}.${sig}`)).toBeNull();
    expect(await readStamp(`${body}.x${sig.slice(1)}`)).toBeNull();
    expect(await readStamp("junk")).toBeNull();
  });
  it("expires after 8h idle or 7 days, and refreshes last-used every few minutes", () => {
    const now = 10 * MAX_MS;
    expect(stampState({ uid: "u", start: now - 1000, last: now - 1000 }, now)).toBe("ok");
    expect(stampState({ uid: "u", start: now - 3600_000, last: now - TOUCH_MS - 1 }, now)).toBe("touch");
    expect(stampState({ uid: "u", start: now - 3600_000, last: now - IDLE_MS - 1 }, now)).toBe("expired");
    expect(stampState({ uid: "u", start: now - MAX_MS - 1, last: now - 1000 }, now)).toBe("expired");
  });
});

import { signTrust, readTrust, trustValid, TRUST_MS } from "@/lib/session-cookie";
describe("trusted device", () => {
  it("is signed, and only valid for the same login, in time, after the last revocation, with the same authenticator", async () => {
    const now = Date.now();
    const t = { uid: "u1", fid: "f1", iat: now - 1000, exp: now - 1000 + TRUST_MS };
    const v = await signTrust(t);
    expect(await readTrust(v)).toEqual(t);
    expect(await readTrust(v.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    const ok = { uid: "u1", now, validAfter: null, factorIds: ["f1"] };
    expect(trustValid(t, ok)).toBe(true);
    expect(trustValid(t, { ...ok, uid: "u2" })).toBe(false);
    expect(trustValid(t, { ...ok, now: now + TRUST_MS })).toBe(false);
    expect(trustValid(t, { ...ok, validAfter: now })).toBe(false); // signed out everywhere / password changed since
    expect(trustValid(t, { ...ok, factorIds: ["f2"] })).toBe(false); // authenticator removed or replaced
    expect(trustValid(null, ok)).toBe(false);
  });
});
