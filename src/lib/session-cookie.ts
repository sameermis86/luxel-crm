/**
 * The app's own session cookie, on top of Supabase's: who (auth user id), when the session started,
 * and when it was last used. Signed with HMAC-SHA256 (Web Crypto: works in middleware and on the server).
 * Enforces the idle and maximum session lengths and lets "sign out everywhere" end sessions at once.
 */
export const SESSION_COOKIE = "luxel_session";
export const IDLE_MS = 8 * 3600_000; // signed out after 8 hours without activity
export const MAX_MS = 7 * 86_400_000; // and always after 7 days
export const TOUCH_MS = 5 * 60_000; // refresh "last used" at most every 5 minutes

export interface SessionStamp { uid: string; start: number; last: number }

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function secret(env: Record<string, string | undefined> = process.env) {
  const s = env.SESSION_SECRET || env.CRON_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET (or CRON_SECRET) is not set");
  return s;
}
async function key() {
  return crypto.subtle.importKey("raw", enc.encode("luxel-session-v1:" + secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signStamp(s: SessionStamp): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  const sig = b64url(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function readStamp(value: string | undefined | null): Promise<SessionStamp | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionStamp;
    return typeof s.uid === "string" && Number.isFinite(s.start) && Number.isFinite(s.last) ? s : null;
  } catch {
    return null;
  }
}

/** "ok", "expired" (idle or too old) or "touch" (ok, and time to refresh last-used). */
export function stampState(s: SessionStamp, now = Date.now()): "ok" | "touch" | "expired" {
  if (now - s.last > IDLE_MS || now - s.start > MAX_MS || s.start > now + 60_000) return "expired";
  return now - s.last > TOUCH_MS ? "touch" : "ok";
}

export const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: MAX_MS / 1000 };
