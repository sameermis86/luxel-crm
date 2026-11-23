import postgres from "postgres";
import { eq } from "drizzle-orm";
import { withCtx, systemCtx, type Ctx } from "@/db/client";
import { users } from "@/db/schema";
import { seed } from "../scripts/seed";

export const ownerSql = () => postgres(process.env.TEST_DATABASE_OWNER_URL!, { max: 1, onnotice: () => {} });

/** Fresh org per test file: wipes data (as owner, bypassing the append-only trigger) and reseeds. */
export async function freshOrg() {
  const sql = ownerSql();
  await sql.unsafe(`
    ALTER TABLE lead_events DISABLE TRIGGER USER;
    TRUNCATE notifications, saved_views, duplicate_candidates, follow_ups, intake_submissions, lead_events,
             leads, import_batches, campaigns, assignment_rules, org_settings, users, orgs CASCADE;
    ALTER TABLE lead_events ENABLE TRIGGER USER;`);
  await sql.end();
  const orgId = await seed(process.env.TEST_DATABASE_OWNER_URL!);
  const sys = systemCtx(orgId);
  const people = await withCtx(sys, (tx) => tx.select().from(users).where(eq(users.orgId, orgId)));
  const sameer = people.find((p) => p.name === "Sameer")!;
  const mansi = people.find((p) => p.name === "Mansi")!;
  const as = (u: { id: string; role: any }): Ctx => ({ orgId, userId: u.id, role: u.role, actorKind: "user" });
  return { orgId, sys, sameer, mansi, as };
}

export async function addUser(orgId: string, name: string, role: "owner" | "manager" | "staff", acceptsLeads = false) {
  const sql = ownerSql();
  const [u] = await sql`insert into users (org_id, name, email, role, accepts_leads) values (${orgId}, ${name}, ${name.toLowerCase() + "@luxeldecor.com"}, ${role}, ${acceptsLeads}) returning id, role`;
  await sql.end();
  return { id: u.id as string, role: u.role as "owner" | "manager" | "staff" };
}

/** Drizzle wraps driver errors; match against the whole cause chain. */
export async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e: any) {
    const text = [e?.message, e?.cause?.message, e?.cause?.cause?.message].filter(Boolean).join(" | ");
    if (re.test(text)) return;
    throw new Error(`expected error matching ${re} but got: ${text}`);
  }
  throw new Error(`expected rejection matching ${re}`);
}
