import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { withCtx } from "@/db/client";
import { getSession, ctxFor } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { allMatchingLeads } from "@/server/leads/queries";
import { parseLeadFilter } from "@/lib/lead-filters";
import { dateInTz } from "@/lib/dates";

/** CSV of exactly what the leads list shows for the same query string. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const filter = parseLeadFilter(req.nextUrl.searchParams);
  const now = new Date();
  const rows = await withCtx(ctxFor(session), async (tx) => {
    const settings = await getSettings(tx, session.orgId);
    return allMatchingLeads(tx, filter, { now, userId: session.userId, settings }, 50000);
  });
  const csv = Papa.unparse(
    rows.map((r) => ({
      record_id: r.recordId,
      first_name: r.firstName,
      last_name: r.lastName,
      partner_name: r.partnerName,
      email: r.email,
      phone: r.phone,
      event_type: r.eventType,
      event_date: r.eventDate,
      venue: r.venueName,
      guest_count: r.guestCount,
      budget_min: r.budgetMin,
      budget_max: r.budgetMax,
      source: r.source,
      capture_channel: r.captureChannel,
      goodshuffle_stage: r.goodshuffleStatus,
      status: r.status,
      owner: r.ownerName,
      next_follow_up_at: r.nextFollowUpAt?.toISOString() ?? "",
      quote_value: r.quoteValue,
      created_at: r.createdAt.toISOString(),
    })),
  );
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="luxel-leads-${dateInTz(now)}.csv"`,
    },
  });
}
