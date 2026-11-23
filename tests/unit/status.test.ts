import { describe, it, expect } from "vitest";
import { canTransition, transitionRequirements, validateTransition, FUNNEL_RANK } from "@/lib/status";

describe("status transitions", () => {
  it("allows the happy path", () => {
    expect(canTransition("new", "contacted")).toBe(true);
    expect(canTransition("contacted", "consult_scheduled")).toBe(true);
    expect(canTransition("consult_held", "proposal_sent")).toBe(true);
    expect(canTransition("proposal_sent", "won")).toBe(true);
  });
  it("allows skipping ahead (phone call books a consult directly)", () => expect(canTransition("new", "consult_scheduled")).toBe(true));
  it("closed leads can only be reopened in defined ways", () => {
    expect(canTransition("won", "contacted")).toBe(false);
    expect(canTransition("won", "lost")).toBe(true); // cancellation
    expect(canTransition("lost", "contacted")).toBe(true); // reopen
    expect(canTransition("unqualified", "new")).toBe(true);
    expect(canTransition("unqualified", "won")).toBe(false);
  });
  it("no-op transition is not allowed", () => expect(canTransition("new", "new")).toBe(false));
  it("won requires contract value, lost requires a reason, unqualified requires a reason", () => {
    expect(transitionRequirements("won")).toEqual(["contractValue"]);
    expect(validateTransition("proposal_sent", "won", {})).toEqual({ ok: false, error: "Contract value is required to mark a lead won" });
    expect(validateTransition("proposal_sent", "won", { contractValue: 8500 })).toEqual({ ok: true });
    expect(validateTransition("contacted", "lost", {}).ok).toBe(false);
    expect(validateTransition("contacted", "lost", { lostReason: "price" }).ok).toBe(true);
    expect(validateTransition("new", "unqualified", { unqualifiedReason: "" }).ok).toBe(false);
  });
  it("funnel ranks", () => expect(FUNNEL_RANK.won).toBeGreaterThan(FUNNEL_RANK.proposal_sent));
});
