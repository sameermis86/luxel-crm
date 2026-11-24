import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resolveOrgId } from "@/server/org";
import { runWixSync, wixRestClient } from "@/server/intake/wix-sync";
import { configuredCalendars, inspectCalendars, inspectItems, runGoodshuffleSync, setGsCreateLeads } from "@/server/integrations/goodshuffle";
import { runOpsSync } from "@/server/ops/sync";
import { applyBookings, undoBookingWins, runSetmoreSync, setmoreConfigured, setmoreRestClient } from "@/server/integrations/setmore";
import { systemCtx } from "@/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled sync (Wix, Goodshuffle, Ops, Setmore). Called every 15 min by Supabase pg_cron
 * (job "luxel-sync", see docs/scheduling.md); GitHub Actions and Vercel Cron are backups. All send
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
  if (req.nextUrl.searchParams.get("inspect") === "goodshuffle-items") {
    try {
      return NextResponse.json({ ok: true, items: await inspectItems() });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  }
  if (req.nextUrl.searchParams.get("inspect") === "goodshuffle") {
    try {
      return NextResponse.json({ ok: true, calendars: await inspectCalendars() });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  }

  // ?setmore=undo-wins: one-off correction of leads the booking sync created as Won
  if (req.nextUrl.searchParams.get("setmore") === "undo-wins") {
    return NextResponse.json({ ok: true, undoWins: await undoBookingWins(systemCtx(orgId)) });
  }

  const started = Date.now();
  // ?only=ops: just the Fulfillment & Ops sync (e.g. to finish a large first run)
  const only = req.nextUrl.searchParams.get("only");
  const out: Record<string, unknown> = { ok: true };
  let failed = false;
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (only === "ops") {
    // lead syncs skipped
  } else if (apiKey && siteId) {
    try {
      out.wix = await runWixSync(orgId, wixRestClient(apiKey, siteId));
    } catch (e) {
      console.error("[cron] wix sync failed", e);
      out.wix = { error: (e as Error).message };
      failed = true;
    }
  } else out.wix = { skipped: "WIX_API_KEY / WIX_SITE_ID not configured" };

  if (only !== "ops" && Object.keys(configuredCalendars()).length) {
    try {
      // ?goodshuffle=apply-exact: one-off apply of phone/email matches only
      const gsParam = req.nextUrl.searchParams.get("goodshuffle");
      // ?goodshuffle=create-leads: switch on lead creation for unmatched projects, then run
      if (gsParam === "create-leads") await setGsCreateLeads(orgId, true);
      const g = gsParam === "apply-exact"
        ? await runGoodshuffleSync(orgId, { mode: "apply", onlyExact: true })
        : await runGoodshuffleSync(orgId);
      out.goodshuffle = { mode: g.mode, events: g.events, changes: g.changes?.length ?? 0, applied: g.changes?.filter((c) => c.applied).length ?? 0, unmatched: g.unmatched?.length ?? 0, created: g.created ?? 0, tagged: g.tagged ?? 0 };
    } catch (e) {
      console.error("[cron] goodshuffle sync failed", e);
      out.goodshuffle = { error: (e as Error).message };
      failed = true;
    }
  }
  // Fulfillment & Ops: signed Goodshuffle contracts → event board (pull sheets, setup, teardown)
  if (configuredCalendars().signed || configuredCalendars().action_needed) {
    try {
      // whatever is left of the 60s limit (each event commits on its own; the next run continues)
      out.ops = await runOpsSync(orgId, { budgetMs: Math.max(5_000, 48_000 - (Date.now() - started)) });
    } catch (e) {
      console.error("[cron] ops sync failed", e);
      out.ops = { error: (e as Error).message };
      failed = true;
    }
  }
  if (only !== "ops" && setmoreConfigured()) {
    try {
      const sm = await runSetmoreSync(orgId, setmoreRestClient(process.env.SETMORE_REFRESH_TOKEN!.trim()));
      // bookings → leads: link or create, move statuses forward, replace stale follow-ups (see applyBookings)
      const b = await applyBookings(systemCtx(orgId));
      out.setmore = { ...sm, linkedByName: b.linkedByName, created: b.created, statusesApplied: b.statusesApplied, followUpsMoved: b.followUpsMoved, errors: b.errors.length, firstErrors: b.errors.slice(0, 3) };
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
