import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/server/supabase";
import { startSession } from "@/server/session-start";
import { PWLINK_COOKIE, pwLinkCookieOptions, signPwLink } from "@/lib/session-cookie";

/** Invite and password-reset links land here, then go on to `next` (a path on this site only). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const nextParam = req.nextUrl.searchParams.get("next") ?? "/";
  const next = /^\/(?!\/)[\w\-/?=&.]*$/.test(nextParam) ? nextParam : "/";
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?reason=link", req.url));
    const r = await startSession("link");
    if (!r.ok) return NextResponse.redirect(new URL("/login?reason=not_member", req.url));
    // a reset/invite link still asks for the 2-step code (if set up) before anything else but setting a password
    const res = NextResponse.redirect(new URL(next === "/" ? r.next : next, req.url));
    if (next.startsWith("/account/password")) {
      const { data } = await supabase.auth.getUser();
      if (data.user) res.cookies.set(PWLINK_COOKIE, await signPwLink(data.user.id), pwLinkCookieOptions);
    }
    return res;
  }
  return NextResponse.redirect(new URL("/login", req.url));
}
