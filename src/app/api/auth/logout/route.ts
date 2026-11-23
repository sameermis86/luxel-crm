import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DEV_COOKIE, authMode } from "@/server/auth";

export async function POST(req: NextRequest) {
  (await cookies()).delete(DEV_COOKIE);
  if (authMode() === "supabase") {
    const { createSupabaseServer } = await import("@/server/supabase");
    await (await createSupabaseServer()).auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
