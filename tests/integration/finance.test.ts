import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withCtx, closeDb, type Ctx } from "@/db/client";
import { financeContracts, auditLog } from "@/db/schema";
import { createLead, updateLead } from "@/server/leads/service";
import { importContracts, financeOverview } from "@/server/finance";
import { saveMember } from "@/server/team";
import { freshOrg, addUser, rejectsWith } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
let owner: Ctx, lead: string;
const row = (project: string, total: number, paid: number | null, eventDate: string | null) => ({ project, total, paid, balance: paid == null ? null : total - paid, client: "C", name: null, eventDate, status: "Signed" });

beforeAll(async () => {
  env = await freshOrg();
  owner = { orgId: env.orgId, userId: env.sameer.id, role: "owner", actorKind: "user" };
  lead = (await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Sofia", lastName: "Rossi", eventType: "wedding" }))).id;
  await withCtx(env.sys, (tx) => updateLead(tx, env.sys, lead, { goodshuffleProject: "1048207" }));
});
afterAll(closeDb);

describe("finance", () => {
  it("imports contracts, links them to the lead by project number, and re-importing updates", async () => {
    const r = await importContracts(owner, { rows: [row("1048207", 9040, 2712, "2027-06-12"), row("2000001", 5000, 5000, "2026-03-01")], skipped: 1, filename: "gs.csv", mapping: { project: "P", total: "T" } });
    expect(r).toEqual({ created: 2, updated: 0, skipped: 1, linked: 1, replaced: 0 });
    const again = await importContracts(owner, { rows: [row("1048207", 9040, 9040, "2027-06-12")], skipped: 0, filename: "gs2.csv", mapping: { project: "P", total: "T" } });
    expect(again).toMatchObject({ created: 0, updated: 1 });
    const all = await withCtx(owner, (tx) => tx.select().from(financeContracts));
    expect(all.find((c) => c.project === "1048207")).toMatchObject({ leadId: lead, paid: 9040, balance: 0 });
    const log = await withCtx(owner, (tx) => tx.select().from(auditLog));
    expect(log.filter((l) => l.action === "finance.imported").length).toBe(2);
  });

  it("replace: the new file becomes the whole set, in one go, and the audit log says how many went", async () => {
    const before = await withCtx(owner, (tx) => tx.select().from(financeContracts));
    const r = await importContracts(owner, { rows: before.map((c) => row(c.project, c.total ?? 0, c.paid, c.eventDate)), skipped: 0, filename: "same.csv", mapping: {}, replace: true });
    expect(r).toMatchObject({ replaced: before.length, created: before.length, updated: 0 });
    const log = await withCtx(owner, (tx) => tx.select().from(auditLog));
    expect(log.some((l) => (l.metadata as any)?.replacedPrevious === before.length)).toBe(true);
  });

  it("sums a year by event date: booked, collected, still to collect, overdue", async () => {
    const o = await withCtx(owner, (tx) => financeOverview(tx, "2026-01-01", "2027-01-01", "2026-11-25"));
    expect(o.kpis).toMatchObject({ contracts: 1, total: 5000, paid: 5000, balance: 0, overdue: 0 });
    const o2 = await withCtx(owner, (tx) => financeOverview(tx, "2027-01-01", "2028-01-01", "2026-11-25"));
    expect(o2.byMonth).toEqual([{ month: "2027-06", contracts: 1, total: 9040, balance: 0 }]);
  });

  it("is hidden from people without Finance access, read-only at view level (database-enforced)", async () => {
    const mgr = await addUser(env.orgId, "Maya", "manager");
    const mgrCtx: Ctx = { orgId: env.orgId, userId: mgr.id, role: "manager", actorKind: "user" };
    expect(await withCtx(mgrCtx, (tx) => tx.select().from(financeContracts))).toEqual([]); // managers: no finance by default
    await saveMember(owner, { id: mgr.id, name: "Maya", email: "maya@luxeldecor.com", role: "manager", active: true, acceptsLeads: false, access: { finance: "view" } });
    expect((await withCtx(mgrCtx, (tx) => tx.select().from(financeContracts))).length).toBe(2);
    await rejectsWith(importContracts(mgrCtx, { rows: [row("3", 1, null, null)], skipped: 0, filename: null, mapping: {} }), /row-level security/);
  });
});
