import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, type Ctx } from "@/db/client";
import type { AccessLevel, Module, Role } from "@/db/schema";
import { effectiveAccess, hasLevel, LEVELS, requiresMfa, type AccessMap } from "@/lib/access";
import { readStamp, SESSION_COOKIE } from "@/lib/session-cookie";

export interface Session {
  userId: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  /** effective level per module (owners: manage everywhere) */
  access: AccessMap;
  /** sessions that started before this are revoked */
  sessionsValidAfter?: Date | null;
  /**
   * Two-step verification state: "ok" (verified this session), "needs_verify" (has an authenticator,
   * hasn't entered a code yet), "needs_setup" (required but not set up), "off" (not required, not set up).
   */
  mfa?: "ok" | "needs_verify" | "needs_setup" | "off";
  /** this browser's session started before a "sign out everywhere" / password change */
  revoked?: boolean;
}

export const DEV_COOKIE = "luxel_dev_user";

export function authMode(): "dev" | "supabase" {
  const mode = process.env.AUTH_MODE === "supabase" ? "supabase" : "dev";
  if (mode === "dev" && process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1") {
    throw new Error("AUTH_MODE=dev is not allowed in production");
  }
  return mode;
}

import { resolveOrgId } from "./org";
export { resolveOrgId };

/** Effective module levels for a user (explicit rows, else role defaults; owners: everything). */
export async function loadAccess(orgId: string, userId: string, role: Role): Promise<AccessMap> {
  const rows = await getDb().execute<{ module: Module; level: number }>(sql`select * from app.user_modules(${orgId}::uuid, ${userId}::uuid)`);
  const explicit: Partial<Record<Module, AccessLevel>> = {};
  for (const r of rows) explicit[r.module] = LEVELS[r.level] ?? "none";
  return effectiveAccess(role, explicit);
}

async function resolveUser(orgId: string, authUserId: string | null, email: string): Promise<Session | null> {
  const rows = await getDb().execute<{ id: string; org_id: string; name: string; email: string; role: Role; active: boolean; sessions_valid_after: string | Date | null }>(
    sql`select * from app.resolve_user(${orgId}::uuid, ${authUserId}::uuid, ${email})`,
  );
  const u = rows[0];
  if (!u) return null;
  return {
    userId: u.id, orgId: u.org_id, name: u.name, email: u.email, role: u.role,
    access: await loadAccess(u.org_id, u.id, u.role),
    sessionsValidAfter: u.sessions_valid_after ? new Date(u.sessions_valid_after) : null,
  };
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
    return u ? { userId: u.id, orgId, name: u.name, email: u.email, role: u.role, access: await loadAccess(orgId, u.id, u.role) } : null;
  }
  const { createSupabaseServer } = await import("./supabase");
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return null;
  const s = await resolveUser(orgId, data.user.id, data.user.email);
  if (!s) return null;

  // our session cookie (set at sign-in; the middleware enforces idle/max age and refreshes it)
  const stamp = await readStamp((await cookies()).get(SESSION_COOKIE)?.value);
  if (!stamp || stamp.uid !== data.user.id) return { ...s, revoked: true };
  if (s.sessionsValidAfter && stamp.start < s.sessionsValidAfter.getTime()) return { ...s, revoked: true };

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // MFA_REQUIRED=off (Vercel) is the emergency switch if 2-step ever stops working; people who set it up still verify
  const required = process.env.MFA_REQUIRED !== "off" && requiresMfa(s.role, s.access);
  s.mfa = aal?.currentLevel === "aal2" ? "ok" : aal?.nextLevel === "aal2" ? "needs_verify" : required ? "needs_setup" : "off";
  return s;
}

/**
 * The signed-in person, or a redirect: to sign in, to sign out a revoked session, to enter their
 * 2-step code, or to set up 2-step when their access requires it. Account pages pass allowPendingMfa
 * so people can set it up.
 */
export async function requireSession(opts: { allowPendingMfa?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.revoked) redirect("/api/auth/logout?reason=revoked");
  if (!opts.allowPendingMfa) {
    if (s.mfa === "needs_verify") redirect("/login/verify");
    if (s.mfa === "needs_setup") redirect("/account?setup=2step");
  }
  return s;
}

export function ctxFor(s: Session): Ctx {
  return { orgId: s.orgId, userId: s.userId, role: s.role, actorKind: "user" };
}

/* -------------------------------------------------------------------------- */
/* Authorization: one place                                                   */
/* -------------------------------------------------------------------------- */

export type Action =
  | "sales:view"
  | "leads:read_all"
  | "leads:write"
  | "leads:bulk"
  | "leads:merge"
  | "imports:create"
  | "imports:undo"
  | "ops:view"
  | "ops:write"
  | "finance:view"
  | "finance:manage"
  | "admin:view"
  | "settings:manage"
  | "rules:manage"
  | "users:manage";

/**
 * Every action needs a module level; a few also need a role (seeing everyone's leads is a matter of
 * seniority, not module access). The database enforces the same module levels (app.has_access).
 */
const REQUIRES: Record<Action, { module: Module; level: AccessLevel; roles?: Role[] }> = {
  "sales:view": { module: "sales", level: "view" },
  "leads:read_all": { module: "sales", level: "view", roles: ["owner", "manager"] },
  "leads:write": { module: "sales", level: "edit" },
  "leads:bulk": { module: "sales", level: "manage" },
  "leads:merge": { module: "sales", level: "manage" },
  "imports:create": { module: "sales", level: "manage" },
  "imports:undo": { module: "sales", level: "manage" },
  "ops:view": { module: "ops", level: "view" },
  "ops:write": { module: "ops", level: "edit" },
  "finance:view": { module: "finance", level: "view" },
  "finance:manage": { module: "finance", level: "manage" },
  "admin:view": { module: "admin", level: "view" },
  "settings:manage": { module: "admin", level: "manage" },
  "rules:manage": { module: "admin", level: "manage" },
  "users:manage": { module: "admin", level: "manage" },
};

export function can(s: Pick<Session, "role" | "access">, action: Action) {
  const r = REQUIRES[action];
  return hasLevel(s.access, r.module, r.level) && (!r.roles || r.roles.includes(s.role));
}

export class ForbiddenError extends Error {}
export function authorize(s: Pick<Session, "role" | "access">, action: Action) {
  if (!can(s, action)) throw new ForbiddenError(`Not allowed: ${action}`);
}

/** First page this person may open (for the home redirect and "no access" pages). */
export function homeFor(s: Pick<Session, "role" | "access">): string {
  if (can(s, "sales:view")) return "/";
  if (can(s, "ops:view")) return "/ops";
  if (can(s, "finance:view")) return "/finance";
  if (can(s, "settings:manage")) return "/settings";
  return "/account";
}
