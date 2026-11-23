"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withCtx } from "@/db/client";
import { campaigns, CAMPAIGN_CHANNELS } from "@/db/schema";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  channel: z.enum(CAMPAIGN_CHANNELS),
  utmCampaign: z.string().trim().max(200).transform((s) => (s ? s.toLowerCase() : null)).nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  spend: z.number().nonnegative().nullable(),
  reviewed: z.boolean(),
});

export async function saveCampaignAction(_: unknown, fd: FormData) {
  const session = await requireSession();
  try {
    authorize(session, "campaigns:manage");
    const v = (k: string) => {
      const s = String(fd.get(k) ?? "").trim();
      return s === "" ? null : s;
    };
    const spend = v("spend");
    const input = schema.parse({
      id: v("id") ?? undefined,
      name: v("name") ?? "",
      channel: v("channel") ?? "other",
      utmCampaign: v("utmCampaign") ?? "",
      startDate: v("startDate"),
      endDate: v("endDate"),
      spend: spend === null ? null : Number(spend.replace(/[$,]/g, "")),
      reviewed: fd.get("reviewed") === "on" || fd.get("reviewed") === "1",
    });
    const ctx = ctxFor(session);
    await withCtx(ctx, async (tx) => {
      const { id, ...vals } = input;
      if (id) await tx.update(campaigns).set(vals).where(eq(campaigns.id, id));
      else await tx.insert(campaigns).values({ ...vals, orgId: ctx.orgId });
    });
    revalidatePath("/campaigns");
    revalidatePath("/");
    return { ok: true as const, message: "Saved" };
  } catch (e: any) {
    if (e instanceof ForbiddenError) return { ok: false as const, error: e.message };
    if (e instanceof z.ZodError) return { ok: false as const, error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    if (String(e?.cause?.message ?? e?.message).includes("campaigns_org_utm_uq")) return { ok: false as const, error: "Another campaign already uses that utm_campaign key" };
    console.error(e);
    return { ok: false as const, error: "Couldn't save the campaign" };
  }
}
