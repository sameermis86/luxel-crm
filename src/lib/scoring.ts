import type { EventType, Source } from "@/db/schema";
import type { ScoringConfig } from "./config/defaults";
import { isValidEmail, isValidPhone } from "./normalize";
import { dateInTz, daysBetween } from "./dates";

/**
 * Lead scoring, 0–100. Pure, deterministic, and deliberately blind to anything
 * personal: it reads ONLY fit, budget, timing, intent, contactability and engagement.
 * The input type lists exactly the fields it may see.
 */
export interface ScoringInput {
  eventType: EventType;
  eventDate: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  estimateTotal: number | null;
  source: Source;
  captureChannel: Source | null;
  email: string | null;
  phoneE164: string | null;
}

export interface ActivitySignals {
  repliedToFirstContact: boolean;
  consultBookedOrHeld: boolean;
}

export type Factor = "eventFit" | "budget" | "timing" | "sourceIntent" | "contactability" | "engagement";
export interface FactorScore {
  points: number;
  max: number;
  label: string;
}
export type ScoreBreakdown = Record<Factor, FactorScore>;

export const FACTOR_LABELS: Record<Factor, string> = {
  eventFit: "Event fit",
  budget: "Budget",
  timing: "Timing",
  sourceIntent: "Source intent",
  contactability: "Contactability",
  engagement: "Engagement",
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));
const human = (s: string) => s.replace(/_/g, " ");

export function budgetForScoring(l: Pick<ScoringInput, "budgetMin" | "budgetMax" | "estimateTotal">) {
  if (l.budgetMax != null) return { value: l.budgetMax, from: "budget" as const };
  if (l.budgetMin != null) return { value: l.budgetMin, from: "budget" as const };
  if (l.estimateTotal != null) return { value: l.estimateTotal, from: "estimate" as const };
  return null;
}

export function monthsUntil(eventDate: string, now: Date, tz?: string) {
  return daysBetween(dateInTz(now, tz), eventDate) / 30.4375;
}

export function scoreLead(
  lead: ScoringInput,
  activity: ActivitySignals,
  cfg: ScoringConfig,
  now: Date = new Date(),
): { score: number; breakdown: ScoreBreakdown } {
  const b = {} as ScoreBreakdown;

  // Event fit
  b.eventFit = { points: clamp(cfg.eventFit[lead.eventType] ?? 0, cfg.max.eventFit), max: cfg.max.eventFit, label: human(lead.eventType) };

  // Budget
  const budget = budgetForScoring(lead);
  if (!budget) {
    b.budget = { points: clamp(cfg.budgetUnknown, cfg.max.budget), max: cfg.max.budget, label: "unknown" };
  } else {
    const band = cfg.budgetBands.find((x) => budget.value >= x.min);
    b.budget = {
      points: clamp(band?.points ?? 0, cfg.max.budget),
      max: cfg.max.budget,
      label: money(budget.value) + (budget.from === "estimate" ? " (Quote Builder estimate)" : ""),
    };
  }

  // Timing
  if (!lead.eventDate) {
    b.timing = { points: clamp(cfg.timing.unknown, cfg.max.timing), max: cfg.max.timing, label: "no event date" };
  } else {
    const months = monthsUntil(lead.eventDate, now);
    if (months < 0) {
      b.timing = { points: cfg.timing.past, max: cfg.max.timing, label: "event date has passed" };
    } else {
      // A month count that sits exactly on a boundary goes to the earlier (better) band in config order.
      const band = cfg.timing.bands.find((x) => months >= x.minMonths && months <= x.maxMonths);
      b.timing = {
        points: clamp(band?.points ?? 0, cfg.max.timing),
        max: cfg.max.timing,
        label: `${months.toFixed(1)} months out`,
      };
    }
  }

  // Source intent: the stronger signal of origin and capture channel
  const originPts = cfg.sourceIntent[lead.source] ?? 0;
  const channelPts = lead.captureChannel ? cfg.sourceIntent[lead.captureChannel] ?? 0 : 0;
  const useChannel = channelPts > originPts;
  b.sourceIntent = {
    points: clamp(Math.max(originPts, channelPts), cfg.max.sourceIntent),
    max: cfg.max.sourceIntent,
    label: useChannel ? `${human(lead.captureChannel!)} (via ${human(lead.source)})` : human(lead.source),
  };

  // Contactability
  const hasEmail = isValidEmail(lead.email);
  const hasPhone = isValidPhone(lead.phoneE164);
  const c = hasEmail && hasPhone ? cfg.contactability.both : hasEmail || hasPhone ? cfg.contactability.one : cfg.contactability.none;
  b.contactability = {
    points: clamp(c, cfg.max.contactability),
    max: cfg.max.contactability,
    label: hasEmail && hasPhone ? "email + phone" : hasEmail ? "email only" : hasPhone ? "phone only" : "no valid contact",
  };

  // Engagement
  const e = (activity.repliedToFirstContact ? cfg.engagement.replied : 0) + (activity.consultBookedOrHeld ? cfg.engagement.consult : 0);
  const parts = [activity.repliedToFirstContact && "replied", activity.consultBookedOrHeld && "consult booked"].filter(Boolean);
  b.engagement = { points: clamp(e, cfg.max.engagement), max: cfg.max.engagement, label: parts.length ? parts.join(" + ") : "none yet" };

  const total = Object.values(b).reduce((s, f) => s + f.points, 0);
  return { score: Math.round(clamp(total, 100)), breakdown: b };
}

export type ScoreBand = "hot" | "warm" | "cold";
export function scoreBand(score: number, cfg: Pick<ScoringConfig, "bands">): ScoreBand {
  return score >= cfg.bands.hot ? "hot" : score >= cfg.bands.warm ? "warm" : "cold";
}
