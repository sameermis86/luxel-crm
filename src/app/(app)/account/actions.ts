"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withCtx } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession, ctxFor, authMode } from "@/server/auth";
import { auditNow } from "@/server/audit";
import { breachCount } from "@/server/pwned";
import { arrivedByLink } from "@/server/auth-link";
import { passwordProblems } from "@/lib/password";
import { SESSION_COOKIE, TRUST_COOKIE, cookieOptions, readStamp, readTrust, signStamp, signTrust, trustCookieOptions } from "@/lib/session-cookie";

type R = { ok: true; message: string } | { ok: false; error: string };

/** Account pages work before 2-step is set up, but never with a pending 2-step code. */
async function accountSession() {
  const s = await requireSession({ allowPendingMfa: true });
  if (s.mfa === "needs_verify") redirect("/login/verify?next=/account");
  return s;
}

export async function changePasswordAction(_: R | null, fd: FormData): Promise<R> {
  const s = await accountSession();
  if (authMode() !== "supabase") return { ok: false, error: "Passwords are managed by Supabase sign-in (not used in local development)" };
  const v = z.object({ current: z.string().max(200), next: z.string().max(200), confirm: z.string().max(200) }).safeParse({
    current: fd.get("current") ?? "", next: fd.get("next") ?? "", confirm: fd.get("confirm") ?? "",
  });
  if (!v.success) return { ok: false, error: "Check the form" };
  const { current, next, confirm } = v.data;
  if (next !== confirm) return { ok: false, error: "The new passwords don't match" };
  const problems = passwordProblems(next, { email: s.email, name: s.name });
  if (problems.length) return { ok: false, error: `Use a password with ${problems.join(", ")}` };
  if (next === current) return { ok: false, error: "Choose a password you haven't used here" };
  const breaches = await breachCount(next);
  if (breaches && breaches > 0) return { ok: false, error: `That password has appeared in ${breaches.toLocaleString("en-CA")} data breaches. Choose another.` };

  const byLink = await arrivedByLink();
  if (!byLink) {
    if (!current) return { ok: false, error: "Enter your current password" };
    // check the current password on a separate, throwaway client (it never touches this session)
    const { createClient } = await import("@supabase/supabase-js");
    const probe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await probe.auth.signInWithPassword({ email: s.email, password: current });
    if (error) return { ok: false, error: "Your current password isn't right" };
    await probe.auth.signOut({ scope: "local" });
  }

  const { createSupabaseServer } = await import("@/server/supabase");
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.message };

  // every other session ends; this one carries on with a fresh start time
  const now = Date.now();
  await withCtx(ctxFor(s), (tx) => tx.update(users).set({ sessionsValidAfter: new Date(now) }).where(eq(users.id, s.userId)));
  await supabase.auth.signOut({ scope: "others" });
  const jar = await cookies();
  const stamp = await readStamp(jar.get(SESSION_COOKIE)?.value);
  if (stamp) jar.set(SESSION_COOKIE, await signStamp({ ...stamp, start: now + 1, last: now + 1 }), cookieOptions);
  // this device stays trusted (if it was); trusted devices elsewhere end with the other sessions
  const trust = s.trustedUntil || s.mfa === "ok" ? await readTrust(jar.get(TRUST_COOKIE)?.value) : null;
  if (trust && trust.exp > now) jar.set(TRUST_COOKIE, await signTrust({ ...trust, iat: now + 1 }), trustCookieOptions);
  await auditNow(ctxFor(s), "auth.password_changed", `user:${s.userId}`, { via: byLink ? "email link" : "account page" });
  return { ok: true, message: "Password changed. Other devices have been signed out." };
}

/** End every session of this person, including this one. */
export async function signOutEverywhereAction(): Promise<void> {
  const s = await accountSession();
  await withCtx(ctxFor(s), (tx) => tx.update(users).set({ sessionsValidAfter: new Date() }).where(eq(users.id, s.userId)));
  await auditNow(ctxFor(s), "auth.sign_out_everywhere", `user:${s.userId}`);
  if (authMode() === "supabase") {
    const { createSupabaseServer } = await import("@/server/supabase");
    await (await createSupabaseServer()).auth.signOut({ scope: "global" });
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(TRUST_COOKIE); // every trusted device is forgotten too (sessions_valid_after covers the others)
  redirect("/login?reason=signed_out_everywhere");
}

/**
 * Record a 2-step change made in the browser (Supabase enrol/unenrol). We re-read the person's
 * factors on the server, so the log matches what actually happened.
 */
export async function recordMfaChangeAction(): Promise<R> {
  const s = await requireSession({ allowPendingMfa: true });
  const { createSupabaseServer } = await import("@/server/supabase");
  const { data } = await (await createSupabaseServer()).auth.mfa.listFactors();
  const verified = (data?.totp ?? []).filter((f) => f.status === "verified").length;
  await auditNow(ctxFor(s), verified ? "auth.mfa_enrolled" : "auth.mfa_removed", `user:${s.userId}`, { authenticators: verified });
  return { ok: true, message: verified ? "2-step verification is on" : "2-step verification is off" };
}

/** Stop skipping the 2-step code on this browser. */
export async function untrustDeviceAction(): Promise<void> {
  const s = await accountSession();
  (await cookies()).delete(TRUST_COOKIE);
  await auditNow(ctxFor(s), "auth.device_untrusted", `user:${s.userId}`);
  redirect("/account");
}
