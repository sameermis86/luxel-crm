import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { campaigns, leads, CAMPAIGN_CHANNELS } from "@/db/schema";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { leadsHref } from "@/lib/lead-filters";
import { fmtMoney, titleCase } from "@/lib/format";
import { CampaignForm } from "./campaign-form";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { rows, page } = await withPage(async (tx) => ({
    rows: await tx
      .select({
        c: campaigns,
        n: sql<number>`count(${leads.id}) filter (where ${leads.duplicateOfId} is null and ${leads.archivedAt} is null)::int`,
        won: sql<number>`count(${leads.id}) filter (where ${leads.status} = 'won' and ${leads.duplicateOfId} is null and ${leads.archivedAt} is null)::int`,
      })
      .from(campaigns)
      .leftJoin(leads, eq(leads.campaignId, campaigns.id))
      .groupBy(campaigns.id)
      .orderBy(asc(campaigns.reviewed), asc(campaigns.name)),
  }));
  if (!can(page.session, "campaigns:manage")) redirect("/");
  const channels = CAMPAIGN_CHANNELS.map((c) => ({ value: c, label: titleCase(c) }));
  const unreviewed = rows.filter((r) => !r.c.reviewed).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl">Campaigns</h1>
        <p className="mt-1 text-sm text-muted">
          Leads are matched to a campaign by their <code>utm_campaign</code>. Unknown keys create an <em>unreviewed</em> campaign automatically
          {unreviewed ? <>; <strong className="text-amber">{unreviewed} need review</strong></> : null}. Add spend to see cost per lead on the dashboard.
        </p>
      </div>
      <section className="card p-4">
        <h2 className="mb-2 text-lg">New campaign</h2>
        <CampaignForm channels={channels} />
      </section>
      <section className="space-y-2">
        {rows.map(({ c, n, won }) => (
          <div key={c.id} className={`card p-4 ${c.reviewed ? "" : "border-amber/50"}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <strong>{c.name}</strong>
                {!c.reviewed && <span className="chip border-amber/40 text-amber">unreviewed</span>}
              </div>
              <div className="text-muted">
                <Link className="underline" href={leadsHref({ campaign: [c.id] })}>{n} leads</Link> · <Link className="underline" href={leadsHref({ campaign: [c.id], status: ["won"] })}>{won} won</Link>
                {c.spend != null && n > 0 ? <> · {fmtMoney(c.spend / n)} / lead</> : null}
              </div>
            </div>
            <CampaignForm
              channels={channels}
              initial={{ id: c.id, name: c.name, channel: c.channel, utmCampaign: c.utmCampaign ?? "", startDate: c.startDate ?? "", endDate: c.endDate ?? "", spend: c.spend == null ? "" : String(c.spend), reviewed: c.reviewed }}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
