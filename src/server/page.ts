import "server-only";
import { withCtx, type Tx } from "@/db/client";
import type { WhereContext } from "@/lib/lead-filters";
import { redirect } from "next/navigation";
import { requireSession, ctxFor, can, homeFor, type Action, type Session } from "./auth";
import { getSettings } from "./settings";
import type { Settings } from "@/lib/config/defaults";

export interface PageContext {
  session: Session;
  settings: Settings;
  wc: WhereContext;
  now: Date;
}

/**
 * Run a server component's reads in one RLS-scoped transaction. `need` is the module permission
 * the page requires; without it the person goes to the first page they may open.
 */
export async function withPage<T>(fn: (tx: Tx, p: PageContext) => Promise<T>, need: Action): Promise<T & { page: PageContext }> {
  const session = await requireSession();
  if (!can(session, need)) redirect(homeFor(session));
  const ctx = ctxFor(session);
  const now = new Date();
  return withCtx(ctx, async (tx) => {
    const settings = await getSettings(tx, session.orgId);
    const page: PageContext = { session, settings, now, wc: { now, userId: session.userId, settings } };
    const out = await fn(tx, page);
    return { ...out, page };
  });
}
