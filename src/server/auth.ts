import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, type Ctx } from "@/db/client";
import type { Role } from "@/db/schema";

export interface Session {
  userId: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
}

export const DEV_COOKIE = "luxel_dev_user";

export function authMode(): "dev" | "supabase" {
  const mode = process.env.AUTH_MODE === "supabase" ? "supabase" : "dev";
  if (mode === "dev" && process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1") {
    throw new Error("AUTH_MODE=dev is not allowed in production");
  }
  return mode;
}

export async function resolveOrgId(): Promise<string | null> {
  const slug = process.env.DEFAULT_ORG_SLUG ?? "luxel";
  const rows = await getDb().execute<{ id: string | null }>(sql`select app.resolve_org(${slug}) as id`);
  return rows[0]?.id ?? null;
}

async function resolveUser(orgId: string, authUserId: string | null, email: string): Promise<Session | null> {
  const rows = await getDb().execute<{ id: string; org_id: string; name: string; email: string; role: Role; active: boolean }>(
    sql`select * from app.resolve_user(${orgId}::uuid, ${authUserId}::uuid, ${email})`,
  );
  const u = rows[0];
  return u ? { userId: u.id, orgId: u.org_id, name: u.name, email: u.email, role: u.role } : null;
}

export async function listDevUsers() {
  const orgId = await resolveOrgId();
  if (!orgId) return [];
  return getDb().execute<{ id: string; name: string; email: string; role: Role }>(sql`select * from app.dev_users(${orgId}::uuid)`);
}

/** Provider-agnostic: the rest of the app only ever calls getSession(). */
export async function getSession(): Promise<Session | null> {
  const orgId = await resolveOrgId();
  if (!orgId) return null;
  if (authMode() === "dev") {
    const id = (await cookies()).get(DEV_COOKIE)?.value;
    if (!id) return null;
    const users = await listDevUsers();
    const u = users.find((x) => x.id === id);
    return u ? { userId: u.id, orgId, name: u.name, email: u.email, role: u.role } : null;
  }
  const { createSupabaseServer } = await import("./supabase");
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  return resolveUser(orgId, data.user.id, data.user.email);
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export function ctxFor(s: Session): Ctx {
  return { orgId: s.orgId, userId: s.userId, role: s.role, actorKind: "user" };
}

/* -------------------------------------------------------------------------- */
/* Authorization: one place                                                   */
/* -------------------------------------------------------------------------- */

export type Action =
  | "leads:read_all"
  | "leads:write"
  | "leads:bulk"
  | "leads:merge"
  | "imports:create"
  | "imports:undo"
  | "campaigns:manage"
  | "settings:manage"
  | "rules:manage"
  | "users:manage";

const MATRIX: Record<Action, Role[]> = {
  "leads:read_all": ["owner", "manager"],
  "leads:write": ["owner", "manager", "staff"],
  "leads:bulk": ["owner", "manager"],
  "leads:merge": ["owner"],
  "imports:create": ["owner", "manager"],
  "imports:undo": ["owner"],
  "campaigns:manage": ["owner", "manager"],
  "settings:manage": ["owner"],
  "rules:manage": ["owner"],
  "users:manage": ["owner"],
};

export function can(s: Pick<Session, "role">, action: Action) {
  return MATRIX[action].includes(s.role);
}

export class ForbiddenError extends Error {}
export function authorize(s: Pick<Session, "role">, action: Action) {
  if (!can(s, action)) throw new ForbiddenError(`Not allowed: ${action}`);
}
