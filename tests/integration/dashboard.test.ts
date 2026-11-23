import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withCtx, closeDb, type Ctx } from "@/db/client";
import { createLead, updateLead, setFollowUp } from "@/server/leads/service";
import { resolveCampaignId } from "@/server/leads/intake";
import { computeDashboard } from "@/server/dashboard";
import { listLeads } from "@/server/leads/queries";
import { getSettings } from "@/server/settings";
import { parseLeadFilter, parseListParams, type WhereContext } from "@/lib/lead-filters";
import { parseDashFilter } from "@/lib/metrics";
import type { Source, EventType } from "@/db/schema";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
const NOW = new Date("2026-11-23T17:00:00Z"); // Mon Nov 23, 12:00 Toronto
const TZ = "America/Toronto";

beforeAll(async () => {
  env = await freshOrg();
  const sources: Source[] = ["quote_builder", "instagram", "google_ads", "referral", "contact_us_form"];
  const types: EventType[] = ["wedding", "corporate", "social", "wedding", "rental_only"];
  // 60 leads spread over Sep 1 – Nov 23, including boundary times around Toronto midnight
  await withCtx(env.sys, async (tx) => {
    const camp = await resolveCampaignId(tx, env.sys, "spring-bridal-2027");
    for (let i = 0; i < 60; i++) {
      const createdAt = new Date(Date.UTC(2026, 8, 1) + i * 34 * 3600_000 + (i % 7) * 3600_000);
      const lead = await createLead(
        tx,
        env.sys,
        {
          firstName: `Lead${i}`,
          lastName: `Test${i % 9}`,
          email: i % 11 === 0 ? null : `lead${i}@example.com`,
          phone: i % 4 === 0 ? `41655501${String(i).padStart(2, "0")}` : null,
          eventType: types[i % 5],
          eventDate: i % 6 === 0 ? null : `2027-${String((i % 12) + 1).padStart(2, "0")}-15`,
          budgetMax: i % 5 === 0 ? 1500 : i % 3 === 0 ? null : 4000 + i * 150,
          source: sources[i % 5],
          campaignId: i % 4 === 1 ? camp : null,
          ownerId: i % 2 ? env.sameer.id : i % 3 ? env.mansi.id : null,
          venueCity: i % 13 === 0 ? "Ottawa" : "Toronto",
        },
        { createdAt, now: createdAt },
      );
      const at = (d: number) => new Date(Math.min(createdAt.getTime() + d * 86400_000, NOW.getTime() - 60_000));
      if (i % 3 !== 2) await updateLead(tx, env.sys, lead.id, { status: "contacted", lastContactedAt: at(1) }, { now: at(1) });
      if (i % 4 === 0) await updateLead(tx, env.sys, lead.id, { status: "consult_held" }, { now: at(5) });
      if (i % 8 === 0) await updateLead(tx, env.sys, lead.id, { status: "proposal_sent", quoteValue: 7000 }, { now: at(8) });
      if (i % 16 === 0) await updateLead(tx, env.sys, lead.id, { status: "won", contractValue: 7200, collectedAmount: 2000 }, { now: at(12) });
      if (i % 8 === 4) await updateLead(tx, env.sys, lead.id, { status: "lost", lostReason: "price" }, { now: at(10) });
      if (i % 5 === 1) await setFollowUp(tx, env.sys, lead.id, { dueAt: new Date(NOW.getTime() + (i % 2 ? -1 : 1) * 86400_000) }, at(2));
    }
  });
});
afterAll(closeDb);

/** Follow a dashboard link the way the leads page does and return the count it shows. */
async function countAtHref(ctx: Ctx, wc: WhereContext, href: string) {
  const sp = new URLSearchParams(href.split("?")[1] ?? "");
  const filter = parseLeadFilter(sp);
  const { total } = await withCtx(ctx, (tx) => listLeads(tx, filter, wc, parseListParams(sp)));
  return total;
}

const scenarios: [string, Record<string, string>][] = [
  ["this month (default)", {}],
  ["custom Sep 1 – Nov 23", { from: "2026-09-01", to: "2026-11-23" }],
  ["last month", { range: "last_month" }],
  ["source + owner filter", { from: "2026-09-01", to: "2026-11-30", source: "instagram,referral", owner: "" }],
  ["event type filter", { range: "ytd", event_type: "wedding" }],
];

describe("acceptance: every dashboard number lists exactly that many records", () => {
  for (const [name, params] of scenarios) {
    it(name, async () => {
      for (const who of [env.as(env.sameer), env.sys]) {
        const p = { ...params };
        if (p.owner === "") p.owner = env.sameer.id;
        const settings = await withCtx(who, (tx) => getSettings(tx, env.orgId));
        const wc: WhereContext = { now: NOW, userId: who.userId, settings };
        const df = parseDashFilter(p, NOW, TZ);
        const d = await withCtx(who, (tx) => computeDashboard(tx, df, wc));

        const checks: [string, number, string][] = [];
        for (const c of d.cards) {
          if (c.numerator) {
            checks.push([`${c.key} numerator`, c.numerator.value, c.numerator.href]);
            checks.push([`${c.key} denominator`, c.denominator!.value, c.denominator!.href]);
          } else checks.push([c.key, c.value, c.href]);
        }
        for (const c of d.detail) {
          checks.push([`${c.key} numerator`, c.numerator!.value, c.numerator!.href]);
          checks.push([`${c.key} denominator`, c.denominator!.value, c.denominator!.href]);
        }
        for (const s of d.bySource) {
          checks.push([`source ${s.source}`, s.leads, s.href]);
          checks.push([`source ${s.source} won`, s.won, s.wonHref]);
        }
        for (const c of d.byCampaign) {
          checks.push([`campaign ${c.name}`, c.leads, c.href]);
          checks.push([`campaign ${c.name} qualified`, c.qualified, c.qualifiedHref]);
          checks.push([`campaign ${c.name} won`, c.won, c.wonHref]);
        }
        for (const f of d.funnel) checks.push([`funnel ${f.key}`, f.value, f.href]);
        for (const w of d.weekly) {
          checks.push([`week ${w.week}`, w.total, w.href]);
          for (const q of ["qualified", "needs_info", "unqualified"] as const) checks.push([`week ${w.week} ${q}`, w[q], w.hrefs[q]]);
        }
        checks.push(["revenue won", d.revenue.wonCount, d.revenue.href]);
        checks.push(["goal", d.revenue.goal.count, d.revenue.goal.href]);

        expect(checks.length).toBeGreaterThan(10);
        for (const [label, value, href] of checks) {
          const listed = await countAtHref(who, wc, href);
          expect({ label, href, listed }).toEqual({ label, href, listed: value });
        }
      }
    });
  }

  it("sanity: the numbers are what we seeded", async () => {
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const wc: WhereContext = { now: NOW, userId: null, settings };
    const d = await withCtx(env.sys, (tx) => computeDashboard(tx, parseDashFilter({ from: "2026-08-31", to: "2026-11-30" }, NOW, TZ), wc));
    // (lead 0 is 00:00 UTC Sep 1 = 8pm Aug 31 in Toronto, so the range starts Aug 31)
    const card = (k: string) => d.cards.find((c) => c.key === k)!;
    expect(card("total").value).toBe(60);
    expect(card("qualified").value + card("unqualified").value).toBeLessThanOrEqual(60);
    expect(card("conversion").numerator!.value).toBe(4); // i = 0, 16, 32, 48
    expect(d.funnel.map((f) => f.value)).toEqual([...d.funnel.map((f) => f.value)].sort((a, b) => b - a)); // monotone
    expect(d.bySource.reduce((s, x) => s + x.leads, 0)).toBe(60);
    expect(d.weekly.reduce((s, w) => s + w.total, 0)).toBe(60);
    expect(d.revenue.contract).toBe(4 * 7200);
    expect(d.revenue.outstanding).toBe(4 * 5200);
  });

  it("'new leads this month' ignores the range filter", async () => {
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const wc: WhereContext = { now: NOW, userId: null, settings };
    const a = await withCtx(env.sys, (tx) => computeDashboard(tx, parseDashFilter({ range: "last_month" }, NOW, TZ), wc));
    const b = await withCtx(env.sys, (tx) => computeDashboard(tx, parseDashFilter({ range: "ytd" }, NOW, TZ), wc));
    const v = (x: typeof a) => x.cards.find((c) => c.key === "new_this_month")!.value;
    expect(v(a)).toBe(v(b));
    expect(v(a)).toBeGreaterThan(0);
  });
});
