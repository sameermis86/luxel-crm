import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/server/supabase";
import { startSession } from "@/server/session-start";
import { PWLINK_COOKIE, pwLinkCookieOptions, signPwLink } from "@/lib/session-cookie";

/**
 * Links from invite / admin password-reset emails: ?token_hash=…&type=invite|recovery&next=/account/password.
 * Verifies the one-time token (signs the person in), starts our session, then opens "Set your password".
 */
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type");
  const nextParam = req.nextUrl.searchParams.get("next") ?? "/account/password";
  const next = /^\/(?!\/)[\w\-/?=&.]*$/.test(nextParam) ? nextParam : "/account/password";
  if (!tokenHash || (type !== "invite" && type !== "recovery")) return NextResponse.redirect(new URL("/login?reason=link", req.url));
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return NextResponse.redirect(new URL("/login?reason=link", req.url));
  const r = await startSession("link");
  if (!r.ok) return NextResponse.redirect(new URL("/login?reason=not_member", req.url));
  const { data } = await supabase.auth.getUser();
  const res = NextResponse.redirect(new URL(next, req.url));
  // for the next 30 minutes this browser may set a password without the current one (they may not have one yet)
  if (data.user) res.cookies.set(PWLINK_COOKIE, await signPwLink(data.user.id), pwLinkCookieOptions);
  return res;
}
