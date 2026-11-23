import { NextResponse, type NextRequest } from "next/server";
import { verifyWixRequest, handleWixSubmission, MAX_BODY_BYTES } from "@/server/intake/wix";

export const dynamic = "force-dynamic";

/**
 * POST /api/intake/wix — Wix Quote Builder (Velo) and Contact Us (Automation) submissions.
 * Verified, idempotent on submission_id, and runs the full pipeline in one short
 * transaction (normalize → dedupe → score → qualify → assign → first follow-up).
 * Emails/notifications go out after commit; nothing slow blocks the response.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  if (!verifyWixRequest(raw, req.headers, req.nextUrl, process.env.WIX_INTAKE_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const formHint = req.nextUrl.searchParams.get("form");
    // ?backfill=1: historical import (original submission time, actor = import, no follow-up/assignment).
    // Only with header auth (HMAC/Bearer), never with the URL token the Automation uses.
    const backfill = req.nextUrl.searchParams.get("backfill") === "1" && !req.nextUrl.searchParams.has("token");
    const result = await handleWixSubmission(body, {
      backfill,
      defaultForm: formHint === "quote_builder" || formHint === "contact_us" ? formHint : undefined,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.outcome === "created" ? 201 : 200 });
  } catch (err) {
    console.error("[intake/wix] failed", err);
    // 500 lets Wix/Velo retry; idempotency makes the retry safe
    return NextResponse.json({ error: "intake failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, endpoint: "wix intake", method: "POST" });
}
