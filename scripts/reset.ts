import "dotenv/config";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { seed } from "./seed";

// DEV ONLY: wipes the local database and rebuilds it.
const url = process.env.DATABASE_OWNER_URL!;
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("db:reset refuses to run against a non-local database");
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;
                  CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO luxel_app; CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
await sql.end();
await runMigrations(url);
console.log("seeded", await seed(url));
