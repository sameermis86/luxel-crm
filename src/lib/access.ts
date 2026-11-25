import type { AccessLevel, Module, Role } from "@/db/schema";

/** Module access, shared by server and client. The database mirrors DEFAULTS in app.default_access (0019). */
export const MODULE_LIST: Module[] = ["sales", "ops", "floral", "finance", "admin"];
export const MODULE_LABELS: Record<Module, string> = {
  sales: "Sales & CRM",
  ops: "Fulfillment & Ops",
  floral: "Floral orders",
  finance: "Finance",
  admin: "Admin",
};
export const MODULE_HINTS: Record<Module, string> = {
  sales: "Leads, follow-ups, reminders, imports",
  ops: "Event board, pull sheets, setup and teardown",
  floral: "Stem orders (coming next)",
  finance: "Contracts and revenue",
  admin: "Settings, team & access, integrations, audit log",
};
export const LEVELS: AccessLevel[] = ["none", "view", "edit", "manage"];
export const LEVEL_LABELS: Record<AccessLevel, string> = { none: "No access", view: "View", edit: "Edit", manage: "Manage" };
export const levelNum = (l: AccessLevel) => LEVELS.indexOf(l);

export type AccessMap = Record<Module, AccessLevel>;

/** What a role gets when no explicit level is set. Owners always have full access. */
export function defaultLevel(role: Role, module: Module): AccessLevel {
  if (role === "owner") return "manage";
  if (role === "manager") return module === "sales" ? "manage" : module === "ops" ? "edit" : "none";
  return module === "sales" || module === "ops" ? "edit" : "none";
}

export function effectiveAccess(role: Role, explicit: Partial<Record<Module, AccessLevel>>): AccessMap {
  const out = {} as AccessMap;
  for (const m of MODULE_LIST) out[m] = role === "owner" ? "manage" : explicit[m] ?? defaultLevel(role, m);
  return out;
}

export const hasLevel = (access: AccessMap, module: Module, level: AccessLevel) => levelNum(access[module]) >= levelNum(level);

/** Two-step verification is required for owners and anyone who can see Finance or Admin. */
export const requiresMfa = (role: Role, access: AccessMap) => role === "owner" || hasLevel(access, "finance", "view") || hasLevel(access, "admin", "view");
