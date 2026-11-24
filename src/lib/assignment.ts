import type { EventType, Source } from "@/db/schema";

export interface AssignmentConditions {
  sources?: Source[];
  eventTypes?: EventType[];
  budgetMin?: number;
  budgetMax?: number;
  /** case-insensitive substrings matched against source_detail and venue_name */
  venuePartners?: string[];
}

export interface RuleLike {
  id: string;
  priority: number;
  conditions: AssignmentConditions;
  assignToUserId: string | null;
  roundRobinPool: string[] | null;
  active: boolean;
}

export interface AssignableUser {
  id: string;
  active: boolean;
  acceptsLeads: boolean;
}

export interface AssignmentFacts {
  source: Source;
  eventType: EventType;
  budget: number | null;
  sourceDetail: string | null;
  venueName: string | null;
}

export interface AssignmentResult {
  userId: string | null;
  ruleId: string | null;
  reason: string;
}

export function ruleMatches(c: AssignmentConditions, f: AssignmentFacts): boolean {
  if (c.sources?.length && !c.sources.includes(f.source)) return false;
  if (c.eventTypes?.length && !c.eventTypes.includes(f.eventType)) return false;
  if (c.budgetMin != null && (f.budget == null || f.budget < c.budgetMin)) return false;
  if (c.budgetMax != null && (f.budget == null || f.budget > c.budgetMax)) return false;
  if (c.venuePartners?.length) {
    const hay = `${f.sourceDetail ?? ""} ${f.venueName ?? ""}`.toLowerCase();
    if (!c.venuePartners.some((v) => v.trim() && hay.includes(v.trim().toLowerCase()))) return false;
  }
  return true;
}

/**
 * First matching active rule (lowest priority number) wins. A rule that names
 * a user who is inactive / not accepting leads is skipped. Round robin picks the
 * eligible user with the fewest open leads; ties go to whoever was assigned least recently.
 */
export function pickAssignee(
  facts: AssignmentFacts,
  rules: RuleLike[],
  users: AssignableUser[],
  openLeadCounts: Record<string, number>,
  lastAssignedAt: Record<string, Date | null | undefined> = {},
): AssignmentResult {
  const eligible = new Map(users.filter((u) => u.active && u.acceptsLeads).map((u) => [u.id, u]));
  const sorted = rules.filter((r) => r.active).sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (!ruleMatches(rule.conditions ?? {}, facts)) continue;
    if (rule.assignToUserId) {
      if (eligible.has(rule.assignToUserId)) return { userId: rule.assignToUserId, ruleId: rule.id, reason: "rule" };
      continue;
    }
    const pool = (rule.roundRobinPool?.length ? rule.roundRobinPool : [...eligible.keys()]).filter((id) => eligible.has(id));
    if (!pool.length) continue;
    const pick = [...pool].sort((a, b) => {
      const d = (openLeadCounts[a] ?? 0) - (openLeadCounts[b] ?? 0);
      if (d) return d;
      const ta = lastAssignedAt[a]?.getTime() ?? 0;
      const tb = lastAssignedAt[b]?.getTime() ?? 0;
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b);
    })[0];
    return { userId: pick, ruleId: rule.id, reason: "round_robin" };
  }
  return { userId: null, ruleId: null, reason: "no eligible user" };
}
