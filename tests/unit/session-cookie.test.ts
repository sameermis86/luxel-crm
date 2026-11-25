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
