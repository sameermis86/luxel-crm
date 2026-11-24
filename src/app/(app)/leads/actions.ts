"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { withCtx } from "@/db/client";
import { appointments, notifications, savedViews, LOST_REASONS, STATUSES, EVENT_TYPES, SOURCES, TIERS } from "@/db/schema";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";
import {
  updateLead,
  logActivity,
  setFollowUp,
  completeFollowUp,
  LeadError,
} from "@/server/leads/service";
import { assignLead } from "@/server/leads/assignment";
import { ingestLead } from "@/server/leads/intake";
import { findDuplicates } from "@/server/leads/duplicates";
import { dismissDuplicate } from "@/server/leads/duplicates";
import { getSettings } from "@/server/settings";
import { allMatchingLeads } from "@/server/leads/queries";
import { parseLeadFilter } from "@/lib/lead-filters";
import { parseBudgetRange } from "@/lib/normalize";
import { suggestNextFollowUp } from "@/lib/business-hours";
import { fromZonedTime } from "date-fns-tz";
import { TZ } from "@/lib/dates";

export type ActionResult = { ok: true; message?: string; data?: any } | { ok: false; error: string };

async function run(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    if (e instanceof LeadError || e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null ? undefined : String(v).trim();
};
const nullable = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === undefined ? undefined : v === "" ? null : v;
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === undefined) return undefined;
  if (v === "") return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
/** datetime-local value is Toronto wall time */
const localDate = (v: string | undefined | null) => (v ? fromZonedTime(v, TZ) : null);

/* ----------------------------- create ------------------------------------- */

export async function createLeadAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  let leadId = "";
  const res = await run(async () => {
    authorize(session, "leads:write");
    const budget = parseBudgetRange(str(fd, "budget") ?? "");
    const source = z.enum(SOURCES).parse(str(fd, "source") || "phone");
    const channel = z.enum(SOURCES).nullable().parse(nullable(fd, "captureChannel") ?? null);
    const input = {
      firstName: nullable(fd, "firstName") ?? null,
      lastName: nullable(fd, "lastName") ?? null,
      partnerName: nullable(fd, "partnerName") ?? null,
      email: nullable(fd, "email") ?? null,
      phone: nullable(fd, "phone") ?? null,
      eventType: z.enum(EVENT_TYPES).parse(str(fd, "eventType") || "wedding"),
      eventDate: nullable(fd, "eventDate") ?? null,
      venueName: nullable(fd, "venueName") ?? null,
      venueCity: nullable(fd, "venueCity") ?? null,
      guestCount: num(fd, "guestCount") ?? null,
      budgetMin: budget.min,
      budgetMax: budget.max,
      tierInterest: z.enum(TIERS).nullable().parse(nullable(fd, "tierInterest") ?? null),
      servicesRequested: fd.getAll("services").map(String),
      message: nullable(fd, "message") ?? null,
      sourceDetail: nullable(fd, "sourceDetail") ?? null,
      explicitSource: source,
      explicitChannel: channel ?? (["phone", "email", "walk_in", "instagram", "facebook", "wedding_show"].includes(source) ? source : null),
    };
    if (!input.firstName && !input.lastName && !input.email && !input.phone) {
      return { ok: false, error: "Enter at least a name, email or phone." };
    }
    const r = await withCtx(ctx, (tx) => ingestLead(tx, ctx, input, { mode: "manual", rawPayload: { form: "manual" } }));
    leadId = r.lead!.id;
  });
  if (!res.ok) return res;
  revalidatePath("/leads");
  redirect(`/leads/${leadId}?created=1`);
}

/** Live duplicate check while typing in the New lead form. */
export async function checkDuplicatesAction(probe: {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  partnerName?: string;
  eventDate?: string;
}) {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const clean = Object.fromEntries(Object.entries(probe).map(([k, v]) => [k, v?.trim() || null]));
  const matches = await withCtx(ctx, (tx) => findDuplicates(tx, ctx, clean));
  return matches.slice(0, 5).map((m) => ({
    id: m.lead.id,
    recordId: m.lead.recordId,
    name: [m.lead.firstName, m.lead.lastName].filter(Boolean).join(" "),
    eventType: m.lead.eventType,
    eventDate: m.lead.eventDate,
    confidence: m.confidence,
    reasons: m.reasons,
  }));
}

/* ----------------------------- edit --------------------------------------- */

const editable = ["firstName", "lastName", "partnerName", "email", "phone", "venueName", "venueCity", "message", "sourceDetail"] as const;

export async function updateLeadFieldsAction(leadId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    authorize(session, "leads:write");
    const patch: Record<string, unknown> = {};
    for (const k of editable) if (fd.has(k)) patch[k] = nullable(fd, k);
    if (fd.has("eventType")) patch.eventType = z.enum(EVENT_TYPES).parse(str(fd, "eventType"));
    if (fd.has("eventDate")) patch.eventDate = nullable(fd, "eventDate");
    if (fd.has("source")) patch.source = z.enum(SOURCES).parse(str(fd, "source"));
    if (fd.has("tierInterest")) patch.tierInterest = z.enum(TIERS).nullable().parse(nullable(fd, "tierInterest"));
    for (const k of ["guestCount", "budgetMin", "budgetMax", "estimateTotal", "quoteValue"]) {
      if (fd.has(k)) patch[k] = num(fd, k);
    }
    if (fd.has("services")) patch.servicesRequested = String(fd.get("services")).split(",").map((s) => s.trim()).filter(Boolean);
    const { changed } = await withCtx(ctx, (tx) => updateLead(tx, ctx, leadId, patch as any));
    return { ok: true, message: changed.length ? `Saved (${changed.length} change${changed.length === 1 ? "" : "s"})` : "No changes" };
  });
  revalidatePath(`/leads/${leadId}`);
  return res;
}

export async function changeStatusAction(leadId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    authorize(session, "leads:write");
    const status = z.enum(STATUSES).parse(str(fd, "status"));
    const patch: Record<string, unknown> = { status };
    if (status === "won" && fd.has("quoteValue")) patch.quoteValue = num(fd, "quoteValue");
    if (status === "lost") {
      patch.lostReason = z.enum(LOST_REASONS).nullable().parse(nullable(fd, "lostReason") ?? null);
      patch.lostReasonDetail = nullable(fd, "lostReasonDetail") ?? null;
    }
    if (status === "unqualified") patch.unqualifiedReason = nullable(fd, "unqualifiedReason") ?? null;
    if (status === "proposal_sent" && fd.has("quoteValue")) patch.quoteValue = num(fd, "quoteValue");
    const consultAt = localDate(str(fd, "consultAt"));
    await withCtx(ctx, async (tx) => {
      const { lead } = await updateLead(tx, ctx, leadId, patch as any);
      if (status === "consult_scheduled" && consultAt) {
        await logActivity(tx, ctx, leadId, { kind: "meeting", summary: `Consult booked for ${str(fd, "consultAt")?.replace("T", " ")}`, occurredAt: new Date() });
      }
      if (fd.get("setFollowUp") === "1" && !["won", "lost", "unqualified", "not_reachable"].includes(lead.status)) {
        const s = await getSettings(tx, ctx.orgId);
        await setFollowUp(tx, ctx, leadId, { dueAt: suggestNextFollowUp(status, new Date(), s.followUps, consultAt), note: `After status → ${status.replace(/_/g, " ")}` });
      }
    });
  });
  revalidatePath(`/leads/${leadId}`);
  return res;
}

/**
 * Status change straight from the leads list. Same rules as the lead page (allowed
 * transitions, reasons for lost/unqualified), logged in the timeline. An open lead with
 * no follow-up gets the default one for its new stage.
 */
export async function changeStatusInlineAction(
  leadId: string,
  input: { status: string; lostReason?: string | null; unqualifiedReason?: string | null },
): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    authorize(session, "leads:write");
    const status = z.enum(STATUSES).parse(input.status);
    const patch: Record<string, unknown> = { status };
    if (status === "lost") patch.lostReason = z.enum(LOST_REASONS).parse(input.lostReason);
    if (status === "unqualified") patch.unqualifiedReason = z.string().trim().min(1, "Give a reason").max(500).parse(input.unqualifiedReason ?? "");
    const lead = await withCtx(ctx, async (tx) => {
      const { lead } = await updateLead(tx, ctx, z.string().uuid().parse(leadId), patch as any);
      if (!["won", "lost", "unqualified", "not_reachable"].includes(lead.status) && !lead.nextFollowUpAt) {
        const s = await getSettings(tx, ctx.orgId);
        await setFollowUp(tx, ctx, lead.id, { dueAt: suggestNextFollowUp(status, new Date(), s.followUps), note: `After status → ${status.replace(/_/g, " ")}` });
      }
      return lead;
    });
    return { ok: true, message: "Status updated", data: { status: lead.status } };
  });
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return res;
}

export async function logActivityAction(leadId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    authorize(session, "leads:write");
    const kind = z.enum(["call", "email", "meeting", "note"]).parse(str(fd, "kind"));
    const summary = str(fd, "summary") ?? "";
    if (kind === "note" && !summary) return { ok: false, error: "Write a note first." };
    const result = await withCtx(ctx, async (tx) => {
      const { lead } = await logActivity(tx, ctx, leadId, {
        kind,
        summary,
        direction: (str(fd, "direction") as "inbound" | "outbound") || "outbound",
        outcome: str(fd, "outcome") || undefined,
        occurredAt: localDate(str(fd, "occurredAt")) ?? undefined,
      });
      const s = await getSettings(tx, ctx.orgId);
      return { lead, suggestion: suggestNextFollowUp(lead.status, new Date(), s.followUps) };
    });
    return { ok: true, message: "Logged", data: { suggestFollowUp: kind !== "note", suggestedAt: result.suggestion.toISOString() } };
  });
  revalidatePath(`/leads/${leadId}`);
  return res;
}

export async function setFollowUpAction(leadId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    authorize(session, "leads:write");
    const dueAt = localDate(str(fd, "dueAt"));
    if (!dueAt) return { ok: false, error: "Pick a date and time." };
    await withCtx(ctx, (tx) => setFollowUp(tx, ctx, leadId, { dueAt, note: nullable(fd, "note") ?? null, ownerId: nullable(fd, "ownerId") ?? undefined }));
    return { ok: true, message: "Follow-up set" };
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/follow-ups");
  return res;
}

export async function completeFollowUpAction(followUpId: string, leadId: string) {
  const session = await requireSession();
  const ctx = ctxFor(session);
  await withCtx(ctx, (tx) => completeFollowUp(tx, ctx, followUpId));
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/follow-ups");
}

export async function reassignAction(leadId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    authorize(session, "leads:write");
    const ownerId = nullable(fd, "ownerId") ?? null;
    await withCtx(ctx, (tx) => assignLead(tx, ctx, leadId, ownerId, { how: "manual" }));
    return { ok: true, message: "Reassigned" };
  });
  revalidatePath(`/leads/${leadId}`);
  return res;
}

export async function dismissDuplicateAction(candidateId: string, leadId: string) {
  const session = await requireSession();
  const ctx = ctxFor(session);
  await withCtx(ctx, (tx) => dismissDuplicate(tx, ctx, candidateId));
  revalidatePath(`/leads/${leadId}`);
}

export async function markNotificationRead(id: string) {
  const session = await requireSession();
  const ctx = ctxFor(session);
  await withCtx(ctx, (tx) => tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, session.userId))));
}

/* ----------------------------- bulk --------------------------------------- */

export async function bulkAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    authorize(session, "leads:bulk");
    const op = z.enum(["assign", "status", "follow_up"]).parse(str(fd, "op"));
    let ids = fd.getAll("ids").map(String).filter(Boolean);
    const scope = str(fd, "scope");
    const now = new Date();
    const result = await withCtx(ctx, async (tx) => {
      const settings = await getSettings(tx, ctx.orgId);
      if (scope === "filter") {
        const filter = parseLeadFilter(new URLSearchParams(str(fd, "query") ?? ""));
        ids = (await allMatchingLeads(tx, filter, { now, userId: session.userId, settings }, 2000)).map((r) => r.id);
      }
      if (!ids.length) return { done: 0, errors: [] as string[] };
      let done = 0;
      const errors: string[] = [];
      for (const id of ids) {
        try {
          // each lead in a savepoint, so one invalid transition doesn't sink the batch
          await tx.transaction(async (sp) => {
            if (op === "assign") await assignLead(sp, ctx, id, nullable(fd, "ownerId") ?? null, { how: "bulk" });
            if (op === "status") {
              const status = z.enum(STATUSES).parse(str(fd, "status"));
              const patch: Record<string, unknown> = { status };
              if (status === "lost") patch.lostReason = z.enum(LOST_REASONS).parse(str(fd, "lostReason") || "other");
              if (status === "unqualified") patch.unqualifiedReason = str(fd, "unqualifiedReason") || "Bulk update";
              await updateLead(sp, ctx, id, patch as any, { settings });
            }
            if (op === "follow_up") {
              const dueAt = localDate(str(fd, "dueAt"));
              if (!dueAt) throw new LeadError("Pick a date");
              await setFollowUp(sp, ctx, id, { dueAt, note: nullable(fd, "note") ?? "Bulk follow-up" });
            }
          });
          done++;
        } catch (e: any) {
          errors.push(e?.message ?? String(e));
        }
      }
      return { done, errors };
    });
    const uniqueErrors = [...new Set(result.errors)].slice(0, 3);
    return result.errors.length
      ? { ok: true, message: `Updated ${result.done}; ${result.errors.length} skipped (${uniqueErrors.join("; ")})` }
      : { ok: true, message: `Updated ${result.done} lead${result.done === 1 ? "" : "s"}` };
  });
  revalidatePath("/leads");
  return res;
}

/* ----------------------------- saved views -------------------------------- */

export async function saveViewAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const res = await run(async () => {
    const name = str(fd, "name");
    if (!name) return { ok: false, error: "Name the view" };
    await withCtx(ctx, (tx) => tx.insert(savedViews).values({ orgId: ctx.orgId, userId: session.userId, name, query: str(fd, "query") ?? "" }));
    return { ok: true, message: "View saved" };
  });
  revalidatePath("/leads");
  return res;
}

export async function deleteViewAction(id: string) {
  const session = await requireSession();
  const ctx = ctxFor(session);
  await withCtx(ctx, (tx) => tx.delete(savedViews).where(inArray(savedViews.id, [id])));
  revalidatePath("/leads");
}

/* ----------------------------- Setmore ------------------------------------- */

/** A Setmore booking with no matching lead → a new lead (status follows the booking), linked to it. */
export async function addLeadFromAppointmentAction(appointmentId: string): Promise<ActionResult> {
  const session = await requireSession();
  let leadId = "";
  const res = await run(async () => {
    authorize(session, "leads:write");
    const id = z.string().uuid().parse(appointmentId);
    const ctx = ctxFor(session);
    return withCtx(ctx, async (tx) => {
      const [a] = await tx.select().from(appointments).where(eq(appointments.id, id));
      if (!a) throw new LeadError("Booking not found");
      if (a.leadId) {
        leadId = a.leadId;
        return;
      }
      const now = new Date();
      const when = a.startsAt.toLocaleString("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
      const r = await ingestLead(
        tx,
        ctx,
        {
          fullName: a.customerName,
          email: a.email,
          phone: a.phoneE164,
          status: a.status === "confirmed" ? (a.startsAt >= now ? "consult_scheduled" : "consult_held") : "new",
          message: `${a.status === "cancelled" ? "Cancelled booking" : "Booked"} in Setmore: ${a.serviceName ?? "consultation"} on ${when}`,
          explicitSource: "other",
          sourceDetail: "Setmore booking",
        },
        { mode: "manual", rawPayload: { form: "setmore", appointmentId: a.externalId } },
      );
      leadId = r.lead!.id;
      await tx.update(appointments).set({ leadId }).where(eq(appointments.id, id));
    });
  });
  if (res.ok) revalidatePath("/leads");
  return res.ok ? { ok: true, data: { leadId }, message: "Lead added" } : res;
}

/** Owners: move leads forward from their Setmore bookings (the plan shown in the Consultations panel). */
export async function applyConsultStatusesAction(): Promise<ActionResult> {
  const session = await requireSession();
  let out = { planned: 0, applied: 0, errors: [] as { recordId: string; error: string }[] };
  const res = await run(async () => {
    authorize(session, "settings:manage");
    const { applyConsultStatuses } = await import("@/server/integrations/setmore");
    out = await applyConsultStatuses(ctxFor(session));
  });
  if (!res.ok) return res;
  revalidatePath("/leads");
  revalidatePath("/");
  return {
    ok: true,
    data: out,
    message: `Updated ${out.applied} lead${out.applied === 1 ? "" : "s"}${out.errors.length ? `; ${out.errors.length} couldn't move (${out.errors.slice(0, 3).map((e) => `${e.recordId}: ${e.error}`).join("; ")})` : ""}`,
  };
}
