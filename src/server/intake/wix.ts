import { createHmac, timingSafeEqual } from "node:crypto";
import { withCtx, systemCtx } from "@/db/client";
import { mapWixPayload } from "@/lib/wix-mapping";
import { ingestLead, type IngestOutcome } from "@/server/leads/intake";
import { resolveOrgId } from "@/server/org";

export const MAX_BODY_BYTES = 256 * 1024;

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sign(rawBody: string, secret: string) {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Accepts, in order of preference:
 *  - X-Luxel-Signature: sha256=<hmac of the raw body>   (Velo snippet)
 *  - Authorization: Bearer <secret>                    (Velo snippet, simpler)
 *  - ?token=<secret>                                   (Wix Automations can't set headers)
 */
export function verifyWixRequest(rawBody: string, headers: Headers, url: URL, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const sig = headers.get("x-luxel-signature");
  if (sig) return safeEqual(sig, sign(rawBody, secret));
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), secret);
  const token = url.searchParams.get("token");
  if (token) return safeEqual(token, secret);
  return false;
}

/** Strip anything secret-looking before the payload is stored in the audit trail. */
export function redact(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body)) return body.map(redact);
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, /secret|token|signature|password|api[_-]?key/i.test(k) ? "[redacted]" : redact(v)]),
  );
}

export interface WixIntakeResult {
  outcome: IngestOutcome;
  recordId: string | null;
  leadId: string | null;
}

export async function handleWixSubmission(
  body: unknown,
  opts: { now?: Date; backfill?: boolean; keepSubmittedAt?: boolean; defaultForm?: "quote_builder" | "contact_us" } = {},
): Promise<WixIntakeResult> {
  const orgId = await resolveOrgId();
  if (!orgId) throw new Error("org not found");
  const mapped = mapWixPayload(body, { defaultForm: opts.defaultForm });
  const ctx = systemCtx(orgId, opts.backfill ? "import" : "webhook");
  const result = await withCtx(ctx, (tx) =>
    ingestLead(tx, ctx, mapped.input, {
      mode: "webhook",
      form: mapped.form,
      submissionId: mapped.submissionId,
      rawPayload: redact(body),
      // backfills and the scheduled sync keep the Wix submission time; live webhooks use "now"
      createdAt: opts.backfill || opts.keepSubmittedAt ? mapped.submittedAt ?? undefined : undefined,
      autoFollowUp: !opts.backfill,
      // historical submissions: no round-robin assignment (and no "assigned to you" flood); bulk-assign later
      autoAssign: !opts.backfill,
      now: opts.now,
    }),
  );
  return { outcome: result.outcome, recordId: result.lead?.recordId ?? null, leadId: result.lead?.id ?? null };
}
