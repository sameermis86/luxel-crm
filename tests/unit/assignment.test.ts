import { describe, it, expect } from "vitest";
import { pickAssignee, type AssignableUser, type RuleLike } from "@/lib/assignment";

const users: AssignableUser[] = [
  { id: "sameer", active: true, acceptsLeads: true },
  { id: "mansi", active: true, acceptsLeads: true },
  { id: "temp", active: true, acceptsLeads: false },
  { id: "gone", active: false, acceptsLeads: true },
];
const rr: RuleLike = { id: "default", priority: 1000, conditions: {}, assignToUserId: null, roundRobinPool: null, active: true };
const facts = {
  source: "quote_builder" as const, eventType: "wedding" as const,
  budget: 9000, sourceDetail: null, venueName: null,
};

describe("pickAssignee", () => {
  it("round robin balances by open lead count", () => {
    expect(pickAssignee(facts, [rr], users, { sameer: 5, mansi: 3 }).userId).toBe("mansi");
    expect(pickAssignee(facts, [rr], users, { sameer: 2, mansi: 3 }).userId).toBe("sameer");
  });
  it("round robin ties go to whoever was assigned least recently", () => {
    const r = pickAssignee(facts, [rr], users, { sameer: 3, mansi: 3 }, { sameer: new Date("2026-11-20"), mansi: new Date("2026-11-22") });
    expect(r.userId).toBe("sameer");
  });
  it("skips users who don't accept leads or are inactive", () => {
    const r = pickAssignee(facts, [rr], users, { sameer: 9, mansi: 9, temp: 0, gone: 0 });
    expect(["sameer", "mansi"]).toContain(r.userId);
  });
  it("first matching rule by priority wins", () => {
    const rules: RuleLike[] = [
      rr,
      { id: "corp", priority: 10, conditions: { eventTypes: ["corporate"] }, assignToUserId: "mansi", roundRobinPool: null, active: true },
      { id: "big-weddings", priority: 20, conditions: { eventTypes: ["wedding"], budgetMin: 8000 }, assignToUserId: "sameer", roundRobinPool: null, active: true },
    ];
    expect(pickAssignee(facts, rules, users, {}).ruleId).toBe("big-weddings");
    expect(pickAssignee({ ...facts, eventType: "corporate" }, rules, users, {}).ruleId).toBe("corp");
    expect(pickAssignee({ ...facts, budget: 3000 }, rules, users, { sameer: 1, mansi: 0 }).ruleId).toBe("default");
  });
  it("conditions: source, budget range, venue partner", () => {
    const rule = (conditions: any): RuleLike => ({ id: "r", priority: 1, conditions, assignToUserId: "mansi", roundRobinPool: null, active: true });
    expect(pickAssignee(facts, [rule({ sources: ["referral"] }), rr], users, {}).ruleId).toBe("default");
    expect(pickAssignee(facts, [rule({ budgetMin: 8000 }), rr], users, {}).ruleId).toBe("r");
    expect(pickAssignee(facts, [rule({ budgetMin: 10000 }), rr], users, {}).ruleId).toBe("default");
    expect(pickAssignee({ ...facts, budget: null }, [rule({ budgetMin: 1 }), rr], users, {}).ruleId).toBe("default");
    expect(
      pickAssignee({ ...facts, source: "venue_partner", sourceDetail: "Paradise Banquet Hall" }, [rule({ venuePartners: ["paradise banquet"] }), rr], users, {}).ruleId,
    ).toBe("r");
  });
  it("a rule pointing at someone who no longer accepts leads falls through", () => {
    const rules: RuleLike[] = [{ id: "r", priority: 1, conditions: {}, assignToUserId: "temp", roundRobinPool: null, active: true }, rr];
    expect(pickAssignee(facts, rules, users, {}).ruleId).toBe("default");
  });
  it("inactive rules are ignored", () => {
    const rules: RuleLike[] = [{ id: "r", priority: 1, conditions: {}, assignToUserId: "mansi", roundRobinPool: null, active: false }, rr];
    expect(pickAssignee(facts, rules, users, { mansi: 10, sameer: 0 }).userId).toBe("sameer");
  });
  it("custom round-robin pool", () => {
    const rules: RuleLike[] = [{ id: "pool", priority: 1, conditions: {}, assignToUserId: null, roundRobinPool: ["mansi"], active: true }];
    expect(pickAssignee(facts, rules, users, { mansi: 50, sameer: 0 }).userId).toBe("mansi");
  });
  it("nobody available = unassigned", () => {
    expect(pickAssignee(facts, [rr], [{ id: "x", active: true, acceptsLeads: false }], {}).userId).toBeNull();
  });
});
