import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/server/supabase";

/** Supabase magic-link / OAuth callback. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", req.url));
}
