import "dotenv/config";
import { withCtx, systemCtx, closeDb } from "@/db/client";
import { ingestLead } from "@/server/leads/intake";
import { updateLead, logActivity, setFollowUp } from "@/server/leads/service";
import type { Source, EventType, Status, LostReason } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * DEV ONLY: realistic demo leads spread over the last ~7 months so the list,
 * lead pages and dashboard have something to show. Deterministic.
 */
let s = 42;
const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];

const FIRST = ["Sofia", "Priya", "Emma", "Olivia", "Aanya", "Chloe", "Maya", "Isabella", "Zara", "Hannah", "Leah", "Noor", "Gianna", "Ava", "Mia", "Simran", "Elena", "Grace", "Natalie", "Rachel", "Daniel", "Marco", "Arjun", "Michael", "Kevin", "Jason"];
const LAST = ["Rossi", "Patel", "Nguyen", "Kim", "Singh", "Bianchi", "Fernandes", "Cohen", "Haddad", "Silva", "Wong", "Ferraro", "Sharma", "Kowalski", "Martin", "Romano", "Gill", "Chen", "Costa", "Ahmed"];
const VENUES: [string, string][] = [["Paradise Banquet Hall", "Vaughan"], ["Universal Eventspace", "Vaughan"], ["Chateau Le Parc", "Woodbridge"], ["The Arlington Estate", "King City"], ["Liberty Grand", "Toronto"], ["Hazelton Manor", "Vaughan"], ["Casa Loma", "Toronto"], ["Royal Ambassador", "Caledon"], ["Paramount Eventspace", "Vaughan"], ["Burlington Golf Club", "Burlington"], ["Château des Charmes", "Niagara-on-the-Lake"], ["Fairmont Château Laurier", "Ottawa"]];
const SOURCES: [Source, number][] = [["quote_builder", 30], ["instagram", 16], ["google_ads", 12], ["contact_us_form", 10], ["referral", 9], ["venue_partner", 7], ["google_business_profile", 6], ["wedding_show", 5], ["phone", 3], ["organic_search", 2]];
const EVENTS: [EventType, number][] = [["wedding", 62], ["corporate", 14], ["social", 16], ["rental_only", 6], ["other", 2]];
const weighted = <T,>(a: [T, number][]) => {
  const t = a.reduce((x, [, w]) => x + w, 0);
  let r = rand() * t;
  for (const [v, w] of a) if ((r -= w) <= 0) return v;
  return a[0][0];
};

async function main() {
  const [{ id: orgId }] = await withCtx(systemCtx("00000000-0000-0000-0000-000000000000"), (tx) =>
    tx.execute<{ id: string }>(sql`select app.resolve_org(${process.env.DEFAULT_ORG_SLUG ?? "luxel"}) as id`),
  );
  const sys = systemCtx(orgId);
  const campaigns = ["spring-bridal-2026", "fall-gala-2026", "ig-reels-weddings", "gbp-posts"];
  const now = new Date();
  let made = 0;
  for (let i = 0; i < 140; i++) {
    const daysAgo = Math.floor(rand() * 210);
    const createdAt = new Date(now.getTime() - daysAgo * 86400000 - Math.floor(rand() * 10) * 3600000);
    const source = weighted(SOURCES);
    const eventType = weighted(EVENTS);
    const monthsOut = 2 + rand() * 14;
    const eventDate = new Date(createdAt.getTime() + monthsOut * 30 * 86400000).toISOString().slice(0, 10);
    const [venue, city] = pick(VENUES);
    const budget = rand() < 0.25 ? null : Math.round((1500 + rand() * 16000) / 250) * 250;
    const first = pick(FIRST);
    const last = pick(LAST);
    const utm = source === "google_ads" ? { utmSource: "google", utmMedium: "cpc", utmCampaign: pick(campaigns.slice(0, 2)) }
      : source === "instagram" && rand() < 0.6 ? { utmSource: "instagram", utmMedium: "social", utmCampaign: "ig-reels-weddings" }
      : source === "google_business_profile" ? { utmSource: "gbp", utmMedium: "organic", utmCampaign: "gbp-posts" } : {};
    await withCtx(sys, async (tx) => {
      const r = await ingestLead(
        tx,
        { ...sys, actorKind: "webhook" },
        {
          firstName: first, lastName: last,
          partnerName: eventType === "wedding" && rand() < 0.6 ? `${pick(FIRST)} ${pick(LAST)}` : null,
          email: `${first}.${last}${i}@example.com`.toLowerCase(),
          phone: rand() < 0.75 ? `416555${String(1000 + i).slice(-4)}` : null,
          eventType, eventDate, venueName: venue, venueCity: city,
          guestCount: Math.round(60 + rand() * 300),
          budgetMax: budget, budgetMin: budget ? Math.round(budget * 0.75) : null,
          estimateTotal: source === "quote_builder" ? Math.round((3000 + rand() * 12000) / 100) * 100 : null,
          tierInterest: source === "quote_builder" ? pick(["effortless", "elegant", "elevated"] as const) : null,
          servicesRequested: ["florals", "centerpieces", ...(rand() < 0.5 ? ["ceremony"] : []), ...(rand() < 0.3 ? ["draping"] : [])],
          message: "Hi! We'd love to learn more about florals and decor for our event.",
          ...utm,
          explicitSource: ["quote_builder", "contact_us_form"].includes(source) || utm.utmSource ? null : source,
          sourceDetail: source === "venue_partner" ? venue : source === "referral" ? `Referred by ${pick(FIRST)} ${pick(LAST)}` : null,
        },
        {
          mode: source === "quote_builder" || source === "contact_us_form" || utm.utmSource ? "webhook" : "manual",
          form: source === "quote_builder" ? "quote_builder" : source === "contact_us_form" || utm.utmSource ? (rand() < 0.6 ? "quote_builder" : "contact_us") : null,
          submissionId: `demo-${i}`,
          createdAt,
          now: createdAt,
          autoFollowUp: true,
        },
      );
      const lead = r.lead!;
      // progress through the funnel
      const roll = rand();
      const steps: Status[] = [];
      if (daysAgo > 1 && roll < 0.85) steps.push("contacted");
      if (daysAgo > 7 && roll < 0.55) steps.push("consult_scheduled");
      if (daysAgo > 14 && roll < 0.45) steps.push("consult_held");
      if (daysAgo > 20 && roll < 0.35) steps.push("proposal_sent");
      let t = createdAt.getTime();
      for (const st of steps) {
        t += (1 + rand() * 5) * 86400000;
        const at = new Date(Math.min(t, now.getTime() - 3600000));
        if (st === "contacted") await logActivity(tx, sys, lead.id, { kind: "call", summary: "Intro call", occurredAt: at }, at);
        else await updateLead(tx, sys, lead.id, st === "proposal_sent" ? { status: st, quoteValue: Math.round((budget ?? 6000) / 100) * 100 } : { status: st }, { now: at });
      }
      t += (2 + rand() * 6) * 86400000;
      const closeAt = new Date(Math.min(t, now.getTime() - 3600000));
      if (steps.includes("proposal_sent") && rand() < 0.62) {
        const value = Math.round(((budget ?? 7000) * (0.85 + rand() * 0.4)) / 50) * 50;
        await updateLead(tx, sys, lead.id, { status: "won", contractValue: value, collectedAmount: Math.round(value * (rand() < 0.5 ? 0.3 : 1)) }, { now: closeAt });
      } else if (steps.length && daysAgo > 30 && rand() < 0.45) {
        await updateLead(tx, sys, lead.id, { status: "lost", lostReason: pick(["price", "date_unavailable", "went_with_competitor", "no_response"] as LostReason[]) }, { now: closeAt });
      } else if (lead.qualification === "unqualified" && rand() < 0.6) {
        await updateLead(tx, sys, lead.id, { status: "unqualified", unqualifiedReason: lead.qualificationReasons[0] ?? "Not a fit" }, { now: closeAt });
      } else if (steps.length && rand() < 0.7) {
        await setFollowUp(tx, sys, lead.id, { dueAt: new Date(now.getTime() + (rand() * 6 - 2) * 86400000), note: "Check in" }, closeAt);
      }
    });
    made++;
  }
  console.log(`demo: created ${made} leads`);
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
