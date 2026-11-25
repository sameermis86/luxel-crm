import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withCtx, type Ctx } from "@/db/client";
import { ROLES, MODULES, ACCESS_LEVELS, userAccess, users, type AccessLevel, type Module } from "@/db/schema";
import { defaultLevel, effectiveAccess } from "@/lib/access";
import { audit } from "./audit";

export const memberSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  active: z.boolean(),
  acceptsLeads: z.boolean(),
  access: z.record(z.enum(MODULES), z.enum(ACCESS_LEVELS)).default({}),
});
export type MemberInput = z.infer<typeof memberSchema>;

export class TeamError extends Error {}

/** Everyone with their effective module levels and which ones are explicit (vs the role's default). */
export async function listTeam(ctx: Ctx) {
  return withCtx(ctx, async (tx) => {
    const people = await tx.select().from(users).orderBy(users.name);
    const rows = people.length ? await tx.select().from(userAccess).where(inArray(userAccess.userId, people.map((p) => p.id))) : [];
    return people.map((p) => {
      const explicit: Partial<Record<Module, AccessLevel>> = {};
      for (const r of rows) if (r.userId === p.id) explicit[r.module as Module] = r.level as AccessLevel;
      return { ...p, explicit, access: effectiveAccess(p.role, explicit) };
    });
  });
}

/**
 * Add or update a team member and their module access, with an audit entry for every change.
 * Guards: you can't demote or deactivate yourself, and there must always be an active owner.
 * Role, access and active state apply on the person's next click (they're re-read on every request).
 */
export async function saveMember(ctx: Ctx, input: MemberInput, now = new Date()) {
  const v = memberSchema.parse(input);
  return withCtx(ctx, async (tx) => {
    const before = v.id ? (await tx.select().from(users).where(eq(users.id, v.id)))[0] : undefined;
    if (v.id && !before) throw new TeamError("User not found");
    if (v.id === ctx.userId && (v.role !== "owner" || !v.active)) throw new TeamError("You can't remove your own owner access");
    if (before?.role === "owner" && (v.role !== "owner" || !v.active)) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "owner"), eq(users.active, true)));
      if (n <= 1) throw new TeamError("There must always be at least one active owner");
    }

    const vals = { name: v.name, email: v.email, role: v.role, active: v.active, acceptsLeads: v.acceptsLeads };
    let id = v.id;
    if (before) await tx.update(users).set(vals).where(eq(users.id, before.id));
    else id = (await tx.insert(users).values({ ...vals, orgId: ctx.orgId }).returning({ id: users.id }))[0].id;

    // module levels: store only what differs from the role's default (owners: always everything)
    const prevRows = await tx.select().from(userAccess).where(eq(userAccess.userId, id!));
    const prev = effectiveAccess(before?.role ?? v.role, Object.fromEntries(prevRows.map((r) => [r.module, r.level])) as Partial<Record<Module, AccessLevel>>);
    await tx.delete(userAccess).where(eq(userAccess.userId, id!));
    const explicit: Partial<Record<Module, AccessLevel>> = {};
    if (v.role !== "owner") {
      for (const m of MODULES) {
        const lvl = v.access[m];
        if (lvl && lvl !== defaultLevel(v.role, m)) {
          explicit[m] = lvl;
          await tx.insert(userAccess).values({ orgId: ctx.orgId, userId: id!, module: m, level: lvl, updatedBy: ctx.userId, updatedAt: now });
        }
      }
    }
    const next = effectiveAccess(v.role, explicit);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (before) for (const k of ["name", "email", "role", "active", "acceptsLeads"] as const) if (before[k] !== vals[k]) changes[k] = { from: before[k], to: vals[k] };
    const accessChanges = Object.fromEntries(MODULES.filter((m) => !before || prev[m] !== next[m]).map((m) => [m, { from: before ? prev[m] : null, to: next[m] }]));

    if (!before) await audit(tx, ctx, "user.created", `user:${id}`, { email: v.email, role: v.role, access: next });
    else {
      if (Object.keys(changes).length) await audit(tx, ctx, "user.updated", `user:${id}`, { changes });
      if (Object.keys(accessChanges).length) await audit(tx, ctx, "access.changed", `user:${id}`, { changes: accessChanges });
      // role, access and active are re-read on every request, so they apply at once; a new email
      // address belongs to (possibly) another login, so sessions of the old one end
      if (changes.email && id !== ctx.userId) await tx.update(users).set({ sessionsValidAfter: now, authUserId: null }).where(eq(users.id, id!));
    }
    return { id: id!, access: next, created: !before };
  });
}
