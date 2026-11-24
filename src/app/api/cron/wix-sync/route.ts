import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resolveOrgId } from "@/server/org";
import { runWixSync, wixRestClient } from "@/server/intake/wix-sync";
import { configuredCalendars, inspectCalendars, runGoodshuffleSync } from "@/server/integrations/goodshuffle";
import { runSetmoreSync, setmoreConfigured, setmoreRestClient } from "@/server/integrations/setmore";

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

  const orgId = await resolveOrgId();
  if (!orgId) return NextResponse.json({ error: "org not found" }, { status: 500 });

  // ?inspect=goodshuffle: masked shape of the Goodshuffle calendars (no client details)
  if (req.nextUrl.searchParams.get("inspect") === "goodshuffle") {
    try {
      return NextResponse.json({ ok: true, calendars: await inspectCalendars() });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  }

  const out: Record<string, unknown> = { ok: true };
  let failed = false;
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (apiKey && siteId) {
    try {
      out.wix = await runWixSync(orgId, wixRestClient(apiKey, siteId));
    } catch (e) {
      console.error("[cron] wix sync failed", e);
      out.wix = { error: (e as Error).message };
      failed = true;
    }
  } else out.wix = { skipped: "WIX_API_KEY / WIX_SITE_ID not configured" };

  if (Object.keys(configuredCalendars()).length) {
    try {
      // ?goodshuffle=apply-exact: one-off apply of phone/email matches only
      const g = req.nextUrl.searchParams.get("goodshuffle") === "apply-exact"
        ? await runGoodshuffleSync(orgId, { mode: "apply", onlyExact: true })
        : await runGoodshuffleSync(orgId);
      out.goodshuffle = { mode: g.mode, events: g.events, changes: g.changes?.length ?? 0, applied: g.changes?.filter((c) => c.applied).length ?? 0, unmatched: g.unmatched?.length ?? 0 };
    } catch (e) {
      console.error("[cron] goodshuffle sync failed", e);
      out.goodshuffle = { error: (e as Error).message };
      failed = true;
    }
  }
  if (setmoreConfigured()) {
    try {
      out.setmore = await runSetmoreSync(orgId, setmoreRestClient(process.env.SETMORE_REFRESH_TOKEN!.trim()));
    } catch (e) {
      console.error("[cron] setmore sync failed", e);
      out.setmore = { error: (e as Error).message };
      failed = true;
    }
  }
  // keep the old top-level shape for the Wix result (status panel / GitHub log)
  if (out.wix && typeof out.wix === "object" && !("error" in (out.wix as object))) Object.assign(out, out.wix);
  return NextResponse.json({ ...out, ok: !failed }, { status: failed ? 502 : 200 });
}

export const GET = handle;
export const POST = handle;
