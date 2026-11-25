import { NextResponse } from "next/server";
import { startSession } from "@/server/session-start";

/** Called by the sign-in form right after Supabase accepts the password. */
export async function POST() {
  const r = await startSession("password");
  return NextResponse.json(r, { status: r.ok ? 200 : 403 });
}
