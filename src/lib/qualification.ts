import type { Qualification } from "@/db/schema";
import type { QualificationConfig } from "./config/defaults";
import { isValidEmail, isValidPhone, normalizeCity } from "./normalize";
import { dateInTz, daysBetween } from "./dates";

export interface QualificationInput {
  eventDate: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  estimateTotal: number | null;
  venueCity: string | null;
  email: string | null;
  phoneE164: string | null;
}

export function inServiceArea(city: string | null, area: string[]): boolean | null {
  const c = normalizeCity(city);
  if (!c) return null;
  const set = area.map(normalizeCity);
  return set.some((a) => c === a || c.startsWith(a + " ") || a.startsWith(c + " "));
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function qualify(
  lead: QualificationInput,
  cfg: QualificationConfig,
  now: Date = new Date(),
): { qualification: Qualification; reasons: string[] } {
  const hard: string[] = [];
  const info: string[] = [];

  if (lead.eventDate) {
    const days = daysBetween(dateInTz(now), lead.eventDate);
    if (days < 0) hard.push("Event date is in the past");
    else if (days < cfg.minLeadTimeDays) hard.push(`Event is ${days} days out (minimum ${cfg.minLeadTimeDays})`);
  }

  const budget = lead.budgetMax ?? lead.budgetMin ?? lead.estimateTotal;
  // Only a stated budget can disqualify; a Quote Builder estimate reflects what they picked, not what they can spend.
  const stated = lead.budgetMax ?? lead.budgetMin;
  if (stated != null && stated < cfg.minBudget) hard.push(`Budget ${money(stated)} is below ${money(cfg.minBudget)}`);

  if (inServiceArea(lead.venueCity, cfg.serviceArea) === false) hard.push(`${lead.venueCity} is outside the service area`);

  if (!isValidEmail(lead.email) && !isValidPhone(lead.phoneE164)) hard.push("No valid email or phone");

  if (hard.length) return { qualification: "unqualified", reasons: hard };

  if (!lead.eventDate) info.push("No event date");
  if (!budget) info.push("No budget");

  // Nothing rules it out: qualified, unless an event date is required and missing.
  // A missing budget is noted but doesn't hold a lead back.
  const qualified = !cfg.requireEventDateForQualified || !!lead.eventDate;
  return qualified ? { qualification: "qualified", reasons: info } : { qualification: "needs_info", reasons: info };
}
