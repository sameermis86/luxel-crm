import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { withCtx, closeDb, type Ctx } from "@/db/client";
import { auditLog, leads, opsEvents, userAccess, MODULES, ROLES } from "@/db/schema";
import { createLead } from "@/server/leads/service";
import { saveMember, listTeam } from "@/server/team";
import { defaultLevel, levelNum } from "@/lib/access";
import { freshOrg, addUser, rejectsWith } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
let staff: { id: string; role: "staff" };
const as = (u: { id: string; role: "owner" | "manager" | "staff" }): Ctx => ({ orgId: env.orgId, userId: u.id, role: u.role, actorKind: "user" });

beforeAll(async () => {
  env = await freshOrg();
  staff = (await addUser(env.orgId, "Priya", "staff")) as { id: string; role: "staff" };
  await withCtx(env.sys, (tx) => createLead(tx, env.sys, { firstName: "Ava", lastName: "Lee", eventType: "wedding" }));
});
afterAll(closeDb);

describe("module access", () => {
  it("the database's role defaults match the app's", async () => {
    for (const r of ROLES)
      for (const m of MODULES) {
        const [row] = await withCtx(env.sys, (tx) => tx.execute<{ n: number }>(sql`select app.default_access(${r}, ${m}) as n`));
        expect([r, m, Number(row.n)]).toEqual([r, m, levelNum(defaultLevel(r, m))]);
      }
  });

  it("the database itself hides a module's data from someone without access, and blocks writes at view level", async () => {
    const owner = as({ id: env.sameer.id, role: "owner" });
    expect((await withCtx(as(staff), (tx) => tx.select().from(leads))).length).toBe(1); // staff default: sales edit

    await saveMember(owner, { id: staff.id, name: "Priya", email: "priya@luxeldecor.com", role: "staff", active: true, acceptsLeads: false, access: { sales: "none", ops: "view" } });
    expect(await withCtx(as(staff), (tx) => tx.select().from(leads))).toEqual([]);
    await rejectsWith(withCtx(as(staff), (tx) => createLead(tx, as(staff), { firstName: "Sneaky", eventType: "wedding" })), /row-level security/);
    // ops at view: can read, can't write
    await withCtx(as(staff), (tx) => tx.select().from(opsEvents));
    await rejectsWith(
      withCtx(as(staff), (tx) => tx.insert(opsEvents).values({ orgId: env.orgId, project: "1", gsUid: "x", gsStatus: "signed", name: "E", rawHash: "h" } as never)),
      /row-level security/,
    );
  });

  it("stores only what differs from the role default, audits changes, and protects the last owner", async () => {
    const owner = as({ id: env.sameer.id, role: "owner" });
    const rows = await withCtx(env.sys, (tx) => tx.select().from(userAccess).where(eq(userAccess.userId, staff.id)));
    expect(rows.map((r) => [r.module, r.level]).sort()).toEqual([["ops", "view"], ["sales", "none"]]);
    const team = await listTeam(owner);
    expect(team.find((t) => t.id === staff.id)!.access).toMatchObject({ sales: "none", ops: "view", finance: "none", admin: "none" });

    const log = await withCtx(env.sys, (tx) => tx.select().from(auditLog).where(eq(auditLog.target, `user:${staff.id}`)));
    expect(log.map((l) => l.action)).toContain("access.changed");
    expect((log.find((l) => l.action === "access.changed")!.metadata as any).changes.sales).toEqual({ from: "edit", to: "none" });

    // Sameer and Mansi are both owners: Sameer can't demote himself; demoting Mansi is fine while Sameer remains
    await expect(saveMember(owner, { id: env.sameer.id, name: "Sameer", email: env.sameer.email, role: "manager", active: true, acceptsLeads: false, access: {} })).rejects.toThrow(/your own owner/);
    await saveMember(owner, { id: env.mansi.id, name: "Mansi", email: env.mansi.email, role: "manager", active: true, acceptsLeads: true, access: {} });
    const mansiCtx = as({ id: env.mansi.id, role: "manager" });
    // a manager without Admin can't change people (the database refuses even if the app check were skipped)
    await expect(withCtx(mansiCtx, (tx) => tx.execute(sql`update users set role = 'owner' where id = ${env.mansi.id}`))).resolves.toBeDefined();
    const [m] = await withCtx(env.sys, (tx) => tx.execute<{ role: string }>(sql`select role from users where id = ${env.mansi.id}`));
    expect(m.role).toBe("manager");
  });

  it("the audit log can't be edited or deleted", async () => {
    const own = postgres(process.env.TEST_DATABASE_OWNER_URL!, { max: 1 });
    try {
      await expect(own`update audit_log set action = 'x'`).rejects.toThrow(/append-only/);
      await expect(own`delete from audit_log`).rejects.toThrow(/append-only/);
    } finally {
      await own.end();
    }
  });
});
