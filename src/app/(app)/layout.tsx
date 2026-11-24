import { requireSession, can, ctxFor } from "@/server/auth";
import { withCtx } from "@/db/client";
import { unreadNotifications } from "@/server/leads/queries";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const notes = await withCtx(ctxFor(session), (tx) => unreadNotifications(tx, session.userId));
  return (
    <Shell
      user={{ name: session.name, role: session.role }}
      canImport={can(session, "imports:create")}
      canSettings={can(session, "settings:manage")}
      notes={notes.map((n) => ({ id: n.id, title: n.title, leadId: n.leadId }))}
    >
      {children}
    </Shell>
  );
}
