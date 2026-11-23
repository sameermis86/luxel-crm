import { config } from "dotenv";
import postgres from "postgres";
import { runMigrations } from "../scripts/migrate";

/** Rebuild the test database from migrations before every run. */
export default async function setup() {
  config({ path: ".env" });
  const owner = process.env.TEST_DATABASE_OWNER_URL!;
  const sql = postgres(owner, { max: 1, onnotice: () => {} });
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;
                    CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO luxel_app;`);
  await sql.end();
  await runMigrations(owner);
}
