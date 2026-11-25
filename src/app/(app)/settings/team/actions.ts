"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";
import { MODULES, ACCESS_LEVELS } from "@/db/schema";
import { saveMember, TeamError } from "@/server/team";

type R = { ok: true; message: string } | { ok: false; error: string };

/** Save a team member and their module access (Admin: manage). */
export async function saveMemberAction(_: R | null, fd: FormData): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "users:manage");
    const access: Record<string, string> = {};
    for (const m of MODULES) {
      const v = fd.get(`access.${m}`);
      if (typeof v === "string" && (ACCESS_LEVELS as readonly string[]).includes(v)) access[m] = v;
    }
    const r = await saveMember(ctxFor(session), {
      id: (fd.get("id") as string) || undefined,
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      role: fd.get("role") as never,
      active: fd.get("active") === "on",
      acceptsLeads: fd.get("acceptsLeads") === "on",
      access: access as never,
    });
    revalidatePath("/settings/team");
    revalidatePath("/settings/audit");
    return { ok: true, message: r.created ? "Added. Send them an invite to set their password." : "Saved" };
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof TeamError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    if (String((e as { cause?: { message?: string } })?.cause?.message ?? e).includes("users_org_email_uq")) return { ok: false, error: "Someone already has that email" };
    console.error(e);
    return { ok: false, error: "Couldn't save" };
  }
}

/**
 * Invite (never signed in) or send a password-reset link (already has a login). Needs the Supabase
 * service-role key; the link lands on /account/password to set a password.
 */
export async function inviteMemberAction(userId: string): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "users:manage");
    const id = z.string().uuid().parse(userId);
    const { withCtx } = await import("@/db/client");
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { audit } = await import("@/server/audit");
    const { supabaseAdmin } = await import("@/server/supabase");
    const { appUrl } = await import("@/server/email");
    const ctx = ctxFor(session);
    const [u] = await withCtx(ctx, (tx) => tx.select().from(users).where(eq(users.id, id)));
    if (!u || !u.active) return { ok: false, error: "This person can't sign in (inactive or missing)" };
    const admin = await supabaseAdmin();
    if (!admin) return { ok: false, error: "Add SUPABASE_SERVICE_ROLE_KEY in Vercel to send invites" };
    const redirectTo = appUrl("/api/auth/callback?next=/account/password");
    const r = u.authUserId
      ? await admin.auth.resetPasswordForEmail(u.email, { redirectTo })
      : await admin.auth.admin.inviteUserByEmail(u.email, { redirectTo });
    if (r.error) return { ok: false, error: r.error.message };
    await withCtx(ctx, (tx) => audit(tx, ctx, u.authUserId ? "auth.password_reset_sent" : "user.invited", `user:${u.id}`, { email: u.email }));
    revalidatePath("/settings/audit");
    return { ok: true, message: u.authUserId ? `Password reset link sent to ${u.email}` : `Invite sent to ${u.email}` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Couldn't send" };
  }
}
