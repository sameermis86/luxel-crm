import { NotConnected } from "./wix-sync-panel";
import type { MailboxState } from "@/server/integrations/mailbox";

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

/** info@ mailbox → emails on lead timelines (read-only, headers only). */
export function MailboxPanel({ configured, mailbox, state }: { configured: boolean; mailbox: string | null; state: MailboxState }) {
  return (
    <section className="card p-5">
      <h2 className="text-[19px]">Mailbox</h2>
      <p className="text-sm text-muted">
        Reads {mailbox ?? "the shared mailbox"} (Sent and Inbox) every sync. An email to a lead is logged on its timeline, counts as contact
        (New → Contacted) and closes the follow-up it took care of; a client&apos;s reply is logged too. Only sender, recipients, date and
        subject are read, and nothing in the mailbox is changed.
      </p>
      {!configured ? (
        <NotConnected>
          Add <code className="font-mono text-xs">MAILBOX_IMAP_USER</code> (info@luxeldecor.com) and <code className="font-mono text-xs">MAILBOX_IMAP_PASSWORD</code> (Sensitive) in Vercel, then redeploy. The server defaults to mail.luxeldecor.com; set <code className="font-mono text-xs">MAILBOX_IMAP_HOST</code> if it differs.
        </NotConnected>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Last check</dt><dd>{fmt(state.lastRunAt)}</dd></div>
            <div><dt className="text-muted">Emails read</dt><dd className="tabular">{state.read ?? 0}</dd></div>
            <div><dt className="text-muted">Logged on leads</dt><dd className="tabular">{state.logged ?? 0}</dd></div>
            <div><dt className="text-muted">Follow-ups done</dt><dd className="tabular">{state.followUpsClosed ?? 0}</dd></div>
          </dl>
          <p className="hint">{state.catchingUp ? "Still reading older mail: the first run works through the backlog over several syncs. " : ""}Numbers are for the last check; each email is logged once.</p>
          {state.lastError && <p className="mt-2 text-sm text-bloom">Last check failed: {state.lastError}</p>}
        </>
      )}
    </section>
  );
}
