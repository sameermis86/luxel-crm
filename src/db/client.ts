import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import type { ActorKind, Role } from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
/** Transaction handle. Every query in the app runs inside one so RLS context is set. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type CtxRole = Role | "system";
/** Who is doing something, and in which org. */
export interface Ctx {
  orgId: string;
  userId: string | null;
  role: CtxRole;
  actorKind: ActorKind;
}

const g = globalThis as unknown as { __luxelDb?: Db; __luxelSql?: postgres.Sql };

export function getDb(): Db {
  if (!g.__luxelDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__luxelSql = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
    g.__luxelDb = drizzle(g.__luxelSql, { schema });
  }
  return g.__luxelDb;
}

export async function closeDb() {
  await g.__luxelSql?.end({ timeout: 5 });
  g.__luxelDb = undefined;
  g.__luxelSql = undefined;
}

/**
 * Run `fn` in a transaction with the RLS context (org, user, role) set.
 * This is the ONLY way application code should touch the database.
 */
const commitHooks = new AsyncLocalStorage<Array<() => unknown>>();

export async function withCtx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const outer = commitHooks.getStore();
  const hooks: Array<() => unknown> = outer ?? [];
  const result = await commitHooks.run(hooks, () =>
    getDb().transaction(async (tx) => {
      await setRlsContext(tx, ctx.orgId, ctx.userId, ctx.role);
      return fn(tx);
    }),
  );
  if (!outer) {
    for (const h of hooks) {
      try {
        await h();
      } catch (err) {
        console.error("[onCommit] hook failed", err);
      }
    }
  }
  return result;
}

async function setRlsContext(tx: Tx, orgId: string, userId: string | null, role: CtxRole) {
  await tx.execute(
    sql`select set_config('app.org_id', ${orgId}, true),
               set_config('app.user_id', ${userId ?? ""}, true),
               set_config('app.role', ${role}, true)`,
  );
}

/** Run `fn` after the surrounding withCtx transaction commits (emails, notifications, job events). */
export function onCommit(fn: () => unknown) {
  const store = commitHooks.getStore();
  if (store) store.push(fn);
  else void Promise.resolve().then(fn);
}

/**
 * Temporarily lift row visibility to the whole org inside a transaction
 * (e.g. duplicate detection must see leads a staff member can't open).
 * Callers must only return minimal, non-sensitive data from `fn`.
 */
export async function asSystem<T>(tx: Tx, ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  if (ctx.role === "system" || ctx.role === "owner" || ctx.role === "manager") return fn();
  await setRlsContext(tx, ctx.orgId, ctx.userId, "system");
  try {
    return await fn();
  } finally {
    await setRlsContext(tx, ctx.orgId, ctx.userId, ctx.role);
  }
}

export function systemCtx(orgId: string, actorKind: ActorKind = "system"): Ctx {
  return { orgId, userId: null, role: "system", actorKind };
}
