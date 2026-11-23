import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/** The single tenant for now (DEFAULT_ORG_SLUG). Multi-tenant later: resolve from host/session. */
export async function resolveOrgId(): Promise<string | null> {
  const slug = process.env.DEFAULT_ORG_SLUG ?? "luxel";
  const rows = await getDb().execute<{ id: string | null }>(sql`select app.resolve_org(${slug}) as id`);
  return rows[0]?.id ?? null;
}
