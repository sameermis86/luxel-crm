import { redirect } from "next/navigation";
import { requireSession, can, ctxFor } from "@/server/auth";
import { withCtx } from "@/db/client";
import { unreadNotifications } from "@/server/leads/queries";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // pages and actions enforce 2-step themselves; the shell also wraps the Account page where it's set up
  const session = await requireSession({ allowPendingMfa: true });
  if (session.mfa === "needs_verify") redirect("/login/verify");
  const notes = can(session, "sales:view") && session.mfa !== "needs_setup" ? await withCtx(ctxFor(session), (tx) => unreadNotifications(tx, session.userId)) : [];
  return (
    <Shell
      user={{ name: session.name, role: session.role }}
      canImport={can(session, "imports:create")}
      canSettings={can(session, "settings:manage")}
      access={session.access}
      notes={notes.map((n) => ({ id: n.id, title: n.title, leadId: n.leadId }))}
    >
      {children}
    </Shell>
  );
}
