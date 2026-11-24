import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withCtx, closeDb, type Ctx } from "@/db/client";
import { createLead, updateLead, setFollowUp } from "@/server/leads/service";
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
          captureChannel: (["quote_builder", "contact_us_form", "goodshuffle", "other"] as const)[i % 4],
          ownerId: i % 2 ? env.sameer.id : i % 3 ? env.mansi.id : null,
          venueCity: i % 13 === 0 ? "Ottawa" : "Toronto",
        },
        { createdAt, now: createdAt },
      );
      const at = (d: number) => new Date(Math.min(createdAt.getTime() + d * 86400_000, NOW.getTime() - 60_000));
      if (i % 3 !== 2) await updateLead(tx, env.sys, lead.id, { status: "contacted", lastContactedAt: at(1) }, { now: at(1) });
      if (i % 4 === 0) await updateLead(tx, env.sys, lead.id, { status: "consult_held" }, { now: at(5) });
      if (i % 8 === 0) await updateLead(tx, env.sys, lead.id, { status: "proposal_sent", quoteValue: 7000 }, { now: at(8) });
      if (i % 16 === 0) await updateLead(tx, env.sys, lead.id, { status: "won" }, { now: at(12) });
      if (i % 8 === 4) await updateLead(tx, env.sys, lead.id, { status: "lost", lostReason: "price" }, { now: at(10) });
      // Goodshuffle stage on every 3rd lead: 5 each of sent / action needed / signed / lost
      if (i % 3 === 0) await updateLead(tx, env.sys, lead.id, { goodshuffleStatus: (["quote_sent", "action_needed", "signed", "lost"] as const)[(i / 3) % 4] }, { now: at(3) });
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
  ["last 12 months (default)", {}],
  ["this month", { range: "this_month" }],
  ["a short range (weekly bars)", { from: "2026-10-01", to: "2026-11-23" }],
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
        for (const c of [...d.leadNums, ...d.quotes]) {
          if (c.numerator) {
            checks.push([`${c.key} numerator`, c.numerator.value, c.numerator.href]);
            checks.push([`${c.key} denominator`, c.denominator!.value, c.denominator!.href]);
          } else checks.push([c.key, c.value, c.href]);
        }
        for (const a of d.actions) {
          checks.push([`action ${a.key}`, a.count, a.href]);
          expect(a.leads.length).toBe(Math.min(4, a.count));
        }
        for (const p of d.pipeline) checks.push([`pipeline ${p.key}`, p.value, p.href]);
        for (const t of d.trend) {
          checks.push([`${d.bucket} ${t.period}`, t.total, t.href]);
          for (const k of ["quote_builder", "contact_us_form", "goodshuffle", "other"] as const) checks.push([`${d.bucket} ${t.period} ${k}`, t[k], t.hrefs[k]]);
        }
        // total leads = the channels added up; total quotes = the stages added up
        const num = (k: string) => [...d.leadNums, ...d.quotes].find((c) => c.key === k)!;
        const leadsN = num("leads").value;
        expect(d.leadNums.filter((c) => c.key.startsWith("ch_")).reduce((s, c) => s + c.value, 0)).toBe(leadsN);
        const quotesN = num("quotes").value;
        expect(d.quotes.filter((c) => c.key.startsWith("q_")).reduce((s, c) => s + c.numerator!.value, 0)).toBe(quotesN);
        for (const q of d.quotes.filter((c) => c.key.startsWith("q_"))) expect(q.denominator!.value).toBe(quotesN);
        expect(quotesN).toBeLessThanOrEqual(leadsN);
        expect(d.trend.reduce((s, t) => s + t.total, 0)).toBe(leadsN);

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
    const card = (k: string) => [...d.leadNums, ...d.quotes].find((c) => c.key === k)!;
    expect(card("leads").value).toBe(60);
    expect(d.bucket).toBe("week"); // 91 days
    expect([card("ch_quote_builder").value, card("ch_contact_us_form").value, card("ch_goodshuffle").value, card("ch_other").value]).toEqual([15, 15, 15, 15]);
    expect(card("quotes").value).toBe(20);
    for (const k of ["q_quote_sent", "q_action_needed", "q_signed", "q_lost"]) {
      expect(card(k).numerator!.value).toBe(5);
      expect(card(k).display).toBe("25%");
    }
    expect(d.pipeline.find((p) => p.key === "quote_out")!.value).toBe(4);
    expect(card("needs_follow_up").value).toBeGreaterThan(0);
  });

  it("a lead with no channel recorded counts under Other, so channels still add up", async () => {
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const wc: WhereContext = { now: NOW, userId: null, settings };
    await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "No", lastName: "Channel", email: "nochannel@example.com" }, { createdAt: new Date("2026-11-20T15:00:00Z"), now: new Date("2026-11-20T15:00:00Z") }));
    const d = await withCtx(env.sys, (tx) => computeDashboard(tx, parseDashFilter({ range: "this_month" }, NOW, TZ), wc));
    const total = d.leadNums.find((c) => c.key === "leads")!.value;
    expect(d.leadNums.filter((c) => c.key.startsWith("ch_")).reduce((s, c) => s + c.value, 0)).toBe(total);
    const other = d.leadNums.find((c) => c.key === "ch_other")!;
    expect(await countAtHref(env.sys, wc, other.href)).toBe(other.value);
  });

  it("next best actions don't double-list a lead between replying and following up", async () => {
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const wc: WhereContext = { now: NOW, userId: null, settings };
    const d = await withCtx(env.sys, (tx) => computeDashboard(tx, parseDashFilter({}, NOW, TZ), wc));
    const ids = (k: string) => new Set(d.actions.find((a) => a.key === k)!.leads.map((l) => l.id));
    for (const id of ids("reply_new")) for (const k of ["overdue", "due_today", "stale_new"]) expect(ids(k).has(id)).toBe(false);
  });

  it("a status synced today for an older lead doesn't count toward this month", async () => {
    // e.g. Goodshuffle marks a July lead Signed today: it belongs to July's numbers
    const settings = await withCtx(env.sys, (tx) => getSettings(tx, env.orgId));
    const wc: WhereContext = { now: NOW, userId: null, settings };
    const month = () => withCtx(env.sys, (tx) => computeDashboard(tx, parseDashFilter({ range: "this_month" }, NOW, TZ), wc));
    const before = await month();
    const old = await withCtx(env.sys, (tx) =>
      createLead(tx, env.sys, { firstName: "July", lastName: "Lead", email: "july@example.com" }, { createdAt: new Date("2026-07-02T15:00:00Z"), now: new Date("2026-07-02T15:00:00Z") }),
    );
    await withCtx(env.sys, (tx) => updateLead(tx, env.sys, old.id, { status: "won", goodshuffleStatus: "signed" }, { now: new Date(NOW.getTime() - 60_000) }));
    const after = await month();
    for (const k of ["leads", "quotes", "q_signed"]) {
      const v = (d: typeof before) => { const c = [...d.leadNums, ...d.quotes].find((x) => x.key === k)!; return c.numerator ? [c.numerator.value, c.denominator!.value] : c.value; };
      expect(v(after)).toEqual(v(before));
    }
  });
});
