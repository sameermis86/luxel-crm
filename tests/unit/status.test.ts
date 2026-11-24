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
  it("won needs nothing extra (revenue lives in the proposals tool); lost and unqualified need a reason", () => {
    expect(transitionRequirements("won")).toEqual([]);
    expect(validateTransition("proposal_sent", "won", {})).toEqual({ ok: true });
    expect(validateTransition("contacted", "lost", {}).ok).toBe(false);
    expect(validateTransition("contacted", "lost", { lostReason: "price" }).ok).toBe(true);
    expect(validateTransition("new", "unqualified", { unqualifiedReason: "" }).ok).toBe(false);
  });
  it("funnel ranks", () => expect(FUNNEL_RANK.won).toBeGreaterThan(FUNNEL_RANK.proposal_sent));
});

describe("not reachable", () => {
  it("closes an open lead without a reason, and reopens when they get back in touch", async () => {
    const { canTransition, validateTransition, isOpen } = await import("@/lib/status");
    expect(canTransition("new", "not_reachable")).toBe(true);
    expect(validateTransition("contacted", "not_reachable", {}).ok).toBe(true);
    expect(isOpen("not_reachable")).toBe(false);
    expect(canTransition("not_reachable", "contacted")).toBe(true);
    expect(canTransition("not_reachable", "won")).toBe(true);
    expect(canTransition("proposal_sent", "not_reachable")).toBe(false); // a quote that goes quiet is Lost
  });
});
