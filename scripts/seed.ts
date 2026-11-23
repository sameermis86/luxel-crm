import "dotenv/config";
import postgres from "postgres";

/**
 * Seed the org, Sameer + Mansi (owners, both accept leads), default settings and
 * the default round-robin rule. Idempotent. Runs as the owner role.
 */
export async function seed(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const slug = process.env.DEFAULT_ORG_SLUG ?? "luxel";
  const [org] = await sql`
    insert into orgs (slug, name) values (${slug}, 'Luxel Decor & Flowers')
    on conflict (slug) do update set name = excluded.name returning id`;
  // SEED_OWNERS="Sameer:sameer@example.com,Mansi:mansi@example.com" overrides the default logins
  const owners = (process.env.SEED_OWNERS ?? "Sameer:sameer@luxeldecor.com,Mansi:mansi@luxeldecor.com")
    .split(",")
    .map((p) => p.trim().split(":"))
    .filter(([n, e]) => n && e)
    .map(([name, email]) => ({ name: name.trim(), email: email.trim().toLowerCase() }));
  for (const u of owners) {
    await sql`
      insert into users (org_id, name, email, role, active, accepts_leads)
      values (${org.id}, ${u.name}, ${u.email}, 'owner', true, true)
      on conflict (org_id, email) do nothing`;
  }
  await sql`insert into org_settings (org_id, settings) values (${org.id}, '{}'::jsonb) on conflict do nothing`;
  const [rule] = await sql`select id from assignment_rules where org_id = ${org.id} limit 1`;
  if (!rule) {
    await sql`
      insert into assignment_rules (org_id, name, priority, conditions, assign_to_user_id, round_robin_pool, active)
      values (${org.id}, 'Default: round robin (everyone accepting leads)', 1000, '{}'::jsonb, null, null, true)`;
  }
  await sql.end();
  return org.id as string;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed(process.env.DATABASE_OWNER_URL!).then((id) => console.log("seeded org", id));
}
