import { headers } from "next/headers";
import { auditLog } from "@/db/schema";
import { withCtx, type Ctx, type Tx } from "@/db/client";

/**
 * Security audit trail (append-only table; the database refuses updates and deletes).
 * Actions: auth.sign_in, auth.sign_out, auth.sign_out_everywhere, auth.password_changed, auth.password_reset,
 * auth.mfa_enrolled, auth.mfa_removed, auth.session_expired, user.created, user.updated, access.changed.
 */
export async function audit(tx: Tx, ctx: Ctx, action: string, target?: string | null, metadata?: Record<string, unknown>) {
  await tx.insert(auditLog).values({ orgId: ctx.orgId, actorUserId: ctx.userId, action, target: target ?? null, metadata: metadata ?? null, ip: await clientIp() });
}

export const auditNow = (ctx: Ctx, action: string, target?: string | null, metadata?: Record<string, unknown>) =>
  withCtx(ctx, (tx) => audit(tx, ctx, action, target, metadata));

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null; // outside a request (jobs, tests)
  }
}
