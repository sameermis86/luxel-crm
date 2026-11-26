import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, ctxFor } from "@/server/auth";
import { auditNow } from "@/server/audit";
import { TRUST_COOKIE, TRUST_MS, signTrust, trustCookieOptions } from "@/lib/session-cookie";

/**
 * Trust this browser for 30 days, right after a 2-step code was entered (the session must be at
 * aal2 now: a trusted cookie can't be used to trust itself).
 */
export async function POST() {
  const s = await getSession();
  if (!s || s.revoked) return NextResponse.json({ ok: false }, { status: 401 });
  const { createSupabaseServer } = await import("@/server/supabase");
  const supabase = await createSupabaseServer();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return NextResponse.json({ ok: false, error: "Enter your code first" }, { status: 403 });
  const [{ data: u }, { data: f }] = await Promise.all([supabase.auth.getUser(), supabase.auth.mfa.listFactors()]);
  const factor = (f?.totp ?? []).find((x) => x.status === "verified");
  if (!u.user || !factor) return NextResponse.json({ ok: false }, { status: 403 });
  const now = Date.now();
  (await cookies()).set(TRUST_COOKIE, await signTrust({ uid: u.user.id, fid: factor.id, iat: now, exp: now + TRUST_MS }), trustCookieOptions);
  await auditNow(ctxFor(s), "auth.device_trusted", `user:${s.userId}`, { days: TRUST_MS / 86_400_000 });
  return NextResponse.json({ ok: true });
}

/** Stop trusting this browser (Account page). */
export async function DELETE() {
  const s = await getSession();
  (await cookies()).delete(TRUST_COOKIE);
  if (s && !s.revoked) await auditNow(ctxFor(s), "auth.device_untrusted", `user:${s.userId}`);
  return NextResponse.json({ ok: true });
}
