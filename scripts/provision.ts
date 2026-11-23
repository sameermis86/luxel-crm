import "dotenv/config";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { seed } from "./seed";

/**
 * Idempotent database provisioning, run on every deploy (`pnpm vercel-build`):
 *   1. ensure the runtime role from DATABASE_URL exists (LOGIN, NOBYPASSRLS) with that password
 *   2. lock Supabase's API roles (anon/authenticated) out of our tables
 *   3. apply migrations, 4. seed the org, owners and default rule (only if missing)
 *
 * Needs DATABASE_OWNER_URL (owner / postgres connection, direct or session pooler)
 * and DATABASE_URL (the app role; on Supabase's pooler the user looks like luxel_app.<project-ref>).
 * Secrets stay in the hosting env; nothing is printed.
 */
async function main() {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    if (process.env.VERCEL) throw new Error("Set DATABASE_OWNER_URL and DATABASE_URL in the Vercel project settings");
    console.log("provision: no database configured, skipping");
    return;
  }
  const app = new URL(appUrl);
  const role = decodeURIComponent(app.username).split(".")[0]; // strip Supabase pooler ".<project-ref>"
  const password = decodeURIComponent(app.password);
  if (role !== "luxel_app") throw new Error(`DATABASE_URL must connect as luxel_app (got ${role})`);
  if (!password) throw new Error("DATABASE_URL needs a password");

  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const [exists] = await sql`select 1 as x from pg_roles where rolname = ${role}`;
    if (!exists) {
      await sql.unsafe(`create role ${role} login nobypassrls password ${quote(password)}`);
      await sql.unsafe(`alter role ${role} set search_path = public, extensions`);
      console.log(`provision: created role ${role}`);
    } else {
      // keep the password in sync with DATABASE_URL where the owner is allowed to (Supabase's postgres user is)
      try {
        await sql.unsafe(`alter role ${role} login nobypassrls password ${quote(password)}`);
        await sql.unsafe(`alter role ${role} set search_path = public, extensions`);
      } catch (e: any) {
        console.log(`provision: role ${role} exists; couldn't update it (${e?.message}), leaving as is`);
      }
    }
    await sql.unsafe(`create extension if not exists pg_trgm`);
  } finally {
    await sql.end();
  }

  await runMigrations(ownerUrl);

  // Supabase grants its PostgREST roles access to new public tables by default. This app
  // never uses PostgREST, so take that away (RLS would already return nothing, but belt and braces).
  const sql2 = postgres(ownerUrl, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const apiRoles = await sql2<{ rolname: string }[]>`select rolname from pg_roles where rolname in ('anon', 'authenticated')`;
    for (const { rolname } of apiRoles) {
      await sql2.unsafe(`revoke all on all tables in schema public from ${rolname}`);
      await sql2.unsafe(`revoke all on all sequences in schema public from ${rolname}`);
      await sql2.unsafe(`revoke all on all functions in schema app from ${rolname}`);
    }
  } finally {
    await sql2.end();
  }

  await seed(ownerUrl);
  console.log("provision: database ready");
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

main().catch((e) => {
  console.error("provision failed:", e?.message ?? e);
  process.exit(1);
});
