import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { passwordProblems } from "@/lib/password";
import { breachCount } from "@/server/pwned";

describe("password policy", () => {
  it("needs 12+ characters with letters and numbers, not personal or trivial", () => {
    expect(passwordProblems("Sunflower-Vase-2027")).toEqual([]);
    expect(passwordProblems("short1")).toContain("at least 12 characters");
    expect(passwordProblems("onlylettershere")).toContain("letters and numbers");
    expect(passwordProblems("sameer-2027-flowers", { email: "sameer@luxeldecor.com" })).toContain("not your name, email or the company name");
    expect(passwordProblems("Luxel2027Decor!")).toContain("not your name, email or the company name");
  });
  it("checks breaches by hash prefix only", async () => {
    const hash = createHash("sha1").update("password123456").digest("hex").toUpperCase();
    let asked = "";
    const fake = (async (url: string) => {
      asked = url;
      return new Response(`0000000000000000000000000000000000A:1\n${hash.slice(5)}:4242\n`);
    }) as unknown as typeof fetch;
    expect(await breachCount("password123456", fake)).toBe(4242);
    expect(asked).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(await breachCount("other-password-77", fake)).toBe(0);
    expect(await breachCount("x", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});
