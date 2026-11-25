import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE, cookieOptions, readStamp, signStamp, stampState } from "@/lib/session-cookie";

// /api/cron authenticates itself with CRON_SECRET; /api/intake with the Wix secret
const PUBLIC = ["/login", "/unsubscribe", "/api/intake", "/api/inngest", "/api/auth", "/api/cron", "/_next", "/favicon"];

/**
 * Cheap gate: bounce to /login when there's obviously no session. The real
 * check (and role lookup) is getSession() on the server; this only avoids
 * rendering protected pages for anonymous visitors and refreshes Supabase tokens.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (process.env.AUTH_MODE === "supabase") {
    let res = NextResponse.next({ request: req });
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (!data.user) return redirectToLogin(req);

    // our own session limits: 8h idle, 7 days max (src/lib/session-cookie.ts)
    const stamp = await readStamp(req.cookies.get(SESSION_COOKIE)?.value);
    const state = stamp && stamp.uid === data.user.id ? stampState(stamp) : "expired";
    if (state === "expired") {
      await supabase.auth.signOut({ scope: "local" });
      const out = redirectToLogin(req, stamp ? "expired" : "signin");
      for (const c of res.cookies.getAll()) out.cookies.set(c); // the cleared Supabase cookies
      out.cookies.delete(SESSION_COOKIE);
      return out;
    }
    if (state === "touch") res.cookies.set(SESSION_COOKIE, await signStamp({ ...stamp!, last: Date.now() }), cookieOptions);
    return res;
  }

  if (!req.cookies.get("luxel_dev_user")?.value) return redirectToLogin(req);
  return NextResponse.next();
}

function redirectToLogin(req: NextRequest, reason?: string) {
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = reason ? `?reason=${reason}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
