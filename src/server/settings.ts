import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { orgSettings } from "@/db/schema";
import { resolveSettings, type Settings } from "@/lib/config/defaults";

export async function getSettings(tx: Tx, orgId: string): Promise<Settings> {
  const [row] = await tx.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
  return resolveSettings(row?.settings);
}
