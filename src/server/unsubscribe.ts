import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, per-lead unsubscribe tokens for reminder emails (CASL needs a working unsubscribe).
 * token = base64url(orgId.leadId) + "." + HMAC-SHA256 (key derived from UNSUBSCRIBE_SECRET or CRON_SECRET).
 */
function key() {
  const base = process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET;
  if (!base || base.length < 16) throw new Error("UNSUBSCRIBE_SECRET (or CRON_SECRET) is not set");
  return createHmac("sha256", base).update("luxel-unsubscribe-v1").digest();
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function unsubscribeToken(orgId: string, leadId: string) {
  const payload = b64(`${orgId}.${leadId}`);
  return `${payload}.${b64(createHmac("sha256", key()).update(payload).digest())}`;
}

export function readUnsubscribeToken(token: string): { orgId: string; leadId: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let want: Buffer;
  try {
    want = createHmac("sha256", key()).update(payload).digest();
  } catch {
    return null; // no secret configured: no link can be valid
  }
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const [orgId, leadId] = Buffer.from(payload, "base64url").toString().split(".");
  const uuid = /^[0-9a-f-]{36}$/i;
  return uuid.test(orgId ?? "") && uuid.test(leadId ?? "") ? { orgId, leadId } : null;
}
