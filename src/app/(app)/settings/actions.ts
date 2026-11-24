"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withCtx } from "@/db/client";
import { assignmentRules, orgSettings, users, EVENT_TYPES, SOURCES, ROLES } from "@/db/schema";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";
import { settingsSchema, DEFAULT_SETTINGS } from "@/lib/config/defaults";
import { parseContactList } from "@/lib/setmore";
import { runNightly } from "@/server/jobs";

type R = { ok: true; message: string } | { ok: false; error: string };
const fail = (e: any): R => {
  if (e instanceof ForbiddenError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const msg = String(e?.cause?.message ?? e?.message ?? e);
  if (msg.includes("users_org_email_uq")) return { ok: false, error: "A user with that email already exists" };
  console.error(e);
  return { ok: false, error: "Couldn't save" };
};

function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    const nextIsIndex = /^\d+$/.test(keys[i + 1]);
    o[k] ??= nextIsIndex ? [] : {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
}

/** Form fields are named by dot path (e.g. scoring.eventFit.wedding). Numbers are coerced; arrays rebuilt. */
export async function saveSettingsAction(_: R | null, fd: FormData): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "settings:manage");
    const next: any = structuredClone(DEFAULT_SETTINGS);
    next.businessHours.days = [];
    const smsTemplates: { label: string; body: string }[] = [];
    for (const [k, raw] of fd.entries()) {
      if (k.startsWith("$") || typeof raw !== "string") continue;
      if (k === "businessHours.timezone") {
        next.businessHours.timezone = raw;
      } else if (k === "businessHours.days") {
        next.businessHours.days.push(Number(raw)); // one checkbox per working day
      } else if (k === "sms.senderName") {
        next.sms.senderName = raw.trim();
      } else if (k.startsWith("sms.templates.")) {
        const [, , i, field] = k.split(".");
        smsTemplates[Number(i)] = { ...(smsTemplates[Number(i)] ?? { label: "", body: "" }), [field]: raw.trim() };
      } else if (k === "setmore.excludeContacts") {
        next.setmore.excludeContacts = parseContactList(raw);
      } else if (raw.trim() !== "") {
        setPath(next, k, Number(raw.replace(/[$,]/g, "")));
      }
    }
    const filled = smsTemplates.filter((t) => t && t.body);
    if (filled.length) next.sms.templates = filled.map((t, i) => ({ label: t.label || `Template ${i + 1}`, body: t.body }));
    const parsed = settingsSchema.parse(next);
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) =>
      tx
        .insert(orgSettings)
        .values({ orgId: ctx.orgId, settings: parsed, updatedBy: session.userId, updatedAt: new Date() })
        .onConflictDoUpdate({ target: orgSettings.orgId, set: { settings: parsed, updatedBy: session.userId, updatedAt: new Date() } }),
    );
    revalidatePath("/settings");
    return { ok: true, message: "Settings saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function resetSettingsAction(): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "settings:manage");
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) => tx.update(orgSettings).set({ settings: {}, updatedBy: session.userId, updatedAt: new Date() }).where(eq(orgSettings.orgId, ctx.orgId)));
    revalidatePath("/settings");
    return { ok: true, message: "Back to defaults" };
  } catch (e) {
    return fail(e);
  }
}

/* ----------------------------- users -------------------------------------- */

export async function saveUserAction(_: R | null, fd: FormData): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "users:manage");
    const input = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email(),
        role: z.enum(ROLES),
        active: z.boolean(),
        acceptsLeads: z.boolean(),
      })
      .parse({
        id: fd.get("id") || undefined,
        name: fd.get("name"),
        email: fd.get("email"),
        role: fd.get("role"),
        active: fd.get("active") === "on",
        acceptsLeads: fd.get("acceptsLeads") === "on",
      });
    if (input.id === session.userId && (input.role !== "owner" || !input.active)) {
      return { ok: false, error: "You can't remove your own owner access" };
    }
    const ctx = ctxFor(session);
    await withCtx(ctx, async (tx) => {
      const { id, ...vals } = input;
      if (id) await tx.update(users).set(vals).where(eq(users.id, id));
      else await tx.insert(users).values({ ...vals, orgId: ctx.orgId });
    });
    revalidatePath("/settings");
    return { ok: true, message: input.id ? "User updated" : "User added. In Supabase mode, invite them from Supabase Auth with the same email." };
  } catch (e) {
    return fail(e);
  }
}

/* ----------------------------- assignment rules --------------------------- */

const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  priority: z.coerce.number().int().min(0).max(100000),
  sources: z.array(z.enum(SOURCES)),
  eventTypes: z.array(z.enum(EVENT_TYPES)),
  budgetMin: z.number().nullable(),
  budgetMax: z.number().nullable(),
  venuePartners: z.array(z.string()),
  assignTo: z.string(),
  pool: z.array(z.string().uuid()),
  active: z.boolean(),
});

export async function saveRuleAction(_: R | null, fd: FormData): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "rules:manage");
    const n = (k: string) => {
      const v = String(fd.get(k) ?? "").replace(/[$,]/g, "").trim();
      return v === "" ? null : Number(v);
    };
    const r = ruleSchema.parse({
      id: fd.get("id") || undefined,
      name: fd.get("name"),
      priority: fd.get("priority"),
      sources: fd.getAll("sources"),
      eventTypes: fd.getAll("eventTypes"),
      budgetMin: n("budgetMin"),
      budgetMax: n("budgetMax"),
      venuePartners: String(fd.get("venuePartners") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      assignTo: String(fd.get("assignTo") ?? "round_robin"),
      pool: fd.getAll("pool"),
      active: fd.get("active") === "on",
    });
    const conditions: Record<string, unknown> = {};
    if (r.sources.length) conditions.sources = r.sources;
    if (r.eventTypes.length) conditions.eventTypes = r.eventTypes;
    if (r.budgetMin != null) conditions.budgetMin = r.budgetMin;
    if (r.budgetMax != null) conditions.budgetMax = r.budgetMax;
    if (r.venuePartners.length) conditions.venuePartners = r.venuePartners;
    const vals = {
      name: r.name,
      priority: r.priority,
      conditions,
      assignToUserId: r.assignTo === "round_robin" ? null : z.string().uuid().parse(r.assignTo),
      roundRobinPool: r.assignTo === "round_robin" && r.pool.length ? r.pool : null,
      active: r.active,
    };
    const ctx = ctxFor(session);
    await withCtx(ctx, async (tx) => {
      if (r.id) await tx.update(assignmentRules).set(vals).where(eq(assignmentRules.id, r.id));
      else await tx.insert(assignmentRules).values({ ...vals, orgId: ctx.orgId });
    });
    revalidatePath("/settings");
    return { ok: true, message: "Rule saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRuleAction(id: string): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "rules:manage");
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) => tx.delete(assignmentRules).where(eq(assignmentRules.id, z.string().uuid().parse(id))));
    revalidatePath("/settings");
    return { ok: true, message: "Rule deleted" };
  } catch (e) {
    return fail(e);
  }
}
