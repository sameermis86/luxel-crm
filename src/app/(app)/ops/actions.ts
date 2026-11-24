"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withCtx } from "@/db/client";
import { opsItems, opsTasks } from "@/db/schema";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";

type R<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    console.error(e);
    return { ok: false, error: "Couldn't save. Please try again." };
  }
}

const id = z.string().uuid();
const step = z.enum(["pulled", "loaded", "returned"]);

/** Tick / untick a pull-sheet line: pulled from the warehouse, loaded on the truck, returned after the event. */
export async function toggleItemAction(itemId: string, which: "pulled" | "loaded" | "returned", on: boolean): Promise<R> {
  const session = await requireSession();
  const res = await run(async () => {
    authorize(session, "ops:write");
    const s = step.parse(which);
    const ctx = ctxFor(session);
    const at = on ? new Date() : null;
    const by = on ? session.userId : null;
    const patch =
      s === "pulled" ? { pulledAt: at, pulledBy: by } : s === "loaded" ? { loadedAt: at, loadedBy: by } : { returnedAt: at, returnedBy: by };
    await withCtx(ctx, (tx) => tx.update(opsItems).set(patch).where(eq(opsItems.id, id.parse(itemId))));
  });
  revalidatePath("/ops");
  return res;
}

const componentSchema = z.object({
  eventId: id,
  parentId: id.nullable(),
  area: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1, "Name the item").max(300),
  qty: z.coerce.number().positive("Quantity must be more than 0").max(100000),
});

/** Add a component under a Goodshuffle package (e.g. "Gold charger plates × 120" under Guest Table Styling). */
export async function addItemAction(input: z.input<typeof componentSchema>): Promise<R> {
  const session = await requireSession();
  const res = await run(async () => {
    authorize(session, "ops:write");
    const v = componentSchema.parse(input);
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) => tx.insert(opsItems).values({ orgId: ctx.orgId, eventId: v.eventId, parentId: v.parentId, area: v.area, name: v.name, qty: v.qty, fromGs: false }));
  });
  revalidatePath("/ops");
  return res;
}

/** Note on a line (damaged, short, substitute…). */
export async function itemNoteAction(itemId: string, note: string): Promise<R> {
  const session = await requireSession();
  const res = await run(async () => {
    authorize(session, "ops:write");
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) => tx.update(opsItems).set({ notes: z.string().trim().max(1000).parse(note) || null }).where(eq(opsItems.id, id.parse(itemId))));
  });
  revalidatePath("/ops");
  return res;
}

/** Remove a component the team added (Goodshuffle lines can't be removed here). */
export async function removeItemAction(itemId: string): Promise<R> {
  const session = await requireSession();
  const res = await run(async () => {
    authorize(session, "ops:write");
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) => tx.update(opsItems).set({ removedAt: new Date() }).where(and(eq(opsItems.id, id.parse(itemId)), eq(opsItems.fromGs, false))));
  });
  revalidatePath("/ops");
  return res;
}

export async function toggleTaskAction(taskId: string, on: boolean): Promise<R> {
  const session = await requireSession();
  const res = await run(async () => {
    authorize(session, "ops:write");
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) => tx.update(opsTasks).set({ doneAt: on ? new Date() : null, doneBy: on ? session.userId : null }).where(eq(opsTasks.id, id.parse(taskId))));
  });
  revalidatePath("/ops");
  return res;
}

const taskSchema = z.object({ eventId: id, phase: z.enum(["setup", "teardown"]), area: z.string().trim().min(1).max(200), title: z.string().trim().min(1, "Describe the task").max(300) });

export async function addTaskAction(input: z.input<typeof taskSchema>): Promise<R> {
  const session = await requireSession();
  const res = await run(async () => {
    authorize(session, "ops:write");
    const v = taskSchema.parse(input);
    const ctx = ctxFor(session);
    await withCtx(ctx, (tx) => tx.insert(opsTasks).values({ orgId: ctx.orgId, ...v, auto: false, sort: 10_000 }).onConflictDoNothing());
  });
  revalidatePath("/ops");
  return res;
}

/** Pull the latest signed projects from Goodshuffle now. */
export async function syncOpsNowAction(): Promise<R<{ projects: number; created: number }>> {
  const session = await requireSession();
  const res = await run(async () => {
    authorize(session, "ops:write");
    const { runOpsSync } = await import("@/server/ops/sync");
    const r = await runOpsSync(session.orgId);
    return { projects: r.projects, created: r.created };
  });
  revalidatePath("/ops");
  return res;
}
