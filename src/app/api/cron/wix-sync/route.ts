import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resolveOrgId } from "@/server/org";
import { runWixSync, wixRestClient } from "@/server/intake/wix-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled Wix → CRM sync. Called by the GitHub Actions schedule (every 15 min),
 * Vercel Cron (daily backup) and Inngest (if connected). All send
 * `Authorization: Bearer $CRON_SECRET` (Vercel Cron does this automatically).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const ok = !!secret && secret.length >= 16 && auth.length === secret.length + 7 && timingSafeEqual(Buffer.from(auth), Buffer.from(`Bearer ${secret}`));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !siteId) return NextResponse.json({ error: "WIX_API_KEY / WIX_SITE_ID not configured" }, { status: 503 });
  const orgId = await resolveOrgId();
  if (!orgId) return NextResponse.json({ error: "org not found" }, { status: 500 });

  try {
    const result = await runWixSync(orgId, wixRestClient(apiKey, siteId));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/wix-sync] failed", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
