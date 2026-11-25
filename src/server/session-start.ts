import { cookies } from "next/headers";
import { resolveOrgId } from "./org";
import { getDb } from "@/db/client";
import { sql } from "drizzle-orm";
import { SESSION_COOKIE, cookieOptions, signStamp } from "@/lib/session-cookie";
import { auditNow } from "./audit";
import type { Ctx } from "@/db/client";

/**
 * After Supabase has signed someone in (password, invite or reset link): check they're an active
 * member, start our session cookie and record the sign-in. Returns where to go next.
 */
export async function startSession(how: "password" | "link"): Promise<{ ok: true; next: string } | { ok: false; error: string }> {
  const { createSupabaseServer } = await import("./supabase");
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return { ok: false, error: "Not signed in" };
  const orgId = await resolveOrgId();
  const rows = orgId
    ? await getDb().execute<{ id: string; role: string }>(sql`select id, role from app.resolve_user(${orgId}::uuid, ${data.user.id}::uuid, ${data.user.email})`)
    : [];
  if (!rows[0]) {
    await supabase.auth.signOut({ scope: "local" });
    return { ok: false, error: "This email isn't set up for the Luxel app. Ask an owner to add you." };
  }
  const now = Date.now();
  (await cookies()).set(SESSION_COOKIE, await signStamp({ uid: data.user.id, start: now, last: now }), cookieOptions);
  const ctx: Ctx = { orgId: orgId!, userId: rows[0].id, role: rows[0].role as Ctx["role"], actorKind: "user" };
  await auditNow(ctx, "auth.sign_in", `user:${rows[0].id}`, { method: how });
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { ok: true, next: aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? "/login/verify" : "/" };
}
