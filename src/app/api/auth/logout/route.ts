import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DEV_COOKIE, authMode, getSession, ctxFor } from "@/server/auth";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { auditNow } from "@/server/audit";

async function signOut(req: NextRequest, reason: string | null) {
  const s = await getSession().catch(() => null);
  if (s && !s.revoked) await auditNow(ctxFor(s), "auth.sign_out", `user:${s.userId}`).catch(() => undefined);
  const jar = await cookies();
  jar.delete(DEV_COOKIE);
  jar.delete(SESSION_COOKIE);
  if (authMode() === "supabase") {
    const { createSupabaseServer } = await import("@/server/supabase");
    await (await createSupabaseServer()).auth.signOut({ scope: "local" });
  }
  return NextResponse.redirect(new URL(reason ? `/login?reason=${reason}` : "/login", req.url), { status: 303 });
}

export const POST = (req: NextRequest) => signOut(req, null);
/** GET only for "your session was ended elsewhere" (signing out is harmless, so no CSRF concern). */
export const GET = (req: NextRequest) => signOut(req, req.nextUrl.searchParams.get("reason") === "revoked" ? "revoked" : null);
