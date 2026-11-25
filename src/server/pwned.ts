import { createHash } from "node:crypto";

/**
 * Has this password appeared in a known data breach? Uses Have I Been Pwned's range API with
 * k-anonymity: only the first 5 characters of the password's SHA-1 hash leave the server, never the
 * password. Returns null if the service can't be reached (the caller decides; we don't block on it).
 */
export async function breachCount(password: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5), rest = hash.slice(5);
  try {
    const r = await fetcher(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    for (const line of (await r.text()).split("\n")) {
      const [suffix, count] = line.trim().split(":");
      if (suffix === rest) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}
