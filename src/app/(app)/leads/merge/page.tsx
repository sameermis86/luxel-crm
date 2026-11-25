import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { leads, users } from "@/db/schema";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { MERGE_FIELDS, defaultChoices } from "@/server/leads/merge";
import { fmtDateTime } from "@/lib/format";
import { MergeForm } from "./merge-form";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  firstName: "First name", lastName: "Last name", partnerName: "Partner", email: "Email", phone: "Phone", eventType: "Event type",
  eventDate: "Event date", venueName: "Venue", venueCity: "Venue city", guestCount: "Guests", budgetMin: "Budget min", budgetMax: "Budget max",
  estimateTotal: "Quote Builder estimate", servicesRequested: "Services", tierInterest: "Tier", message: "Message", source: "Source",
  captureChannel: "Channel", sourceDetail: "Source detail", utmSource: "utm_source", utmMedium: "utm_medium",
  utmContent: "utm_content", utmTerm: "utm_term", landingPage: "Landing page", referrerUrl: "Referrer",
  ownerId: "Owner", quoteValue: "Quote",
};

export default async function MergePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  if (!a || !b || !/^[0-9a-f-]{36}$/.test(a) || !/^[0-9a-f-]{36}$/.test(b)) notFound();
  const data = await withPage(async (tx) => {
    const [la] = await tx.select().from(leads).where(eq(leads.id, a));
    const [lb] = await tx.select().from(leads).where(eq(leads.id, b));
    return { la, lb, people: await tx.select().from(users) };
  }, "leads:merge");
  if (!can(data.page.session, "leads:merge")) redirect(`/leads/${a}`);
  const { la, lb, people } = data;
  if (!la || !lb) notFound();
  // default survivor: the older record
  const [survivor, merged] = la.createdAt <= lb.createdAt ? [la, lb] : [lb, la];
  const show = (f: string, v: unknown) => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "";
    if (f === "ownerId") return people.find((p) => p.id === v)?.name ?? String(v);
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  };
  const side = (l: typeof la) => ({
    id: l.id,
    recordId: l.recordId,
    created: fmtDateTime(l.createdAt),
    status: l.status,
    readOnly: !!(l.duplicateOfId || l.archivedAt),
    values: Object.fromEntries(MERGE_FIELDS.map((f) => [f, show(f, (l as any)[f])])),
  });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Sales & CRM"
        title="Merge duplicates"
        description={<>
          Pick the record to keep, then choose each field. The other record keeps its ID ({merged.recordId} stays a working link), becomes read-only,
          and its history shows on the kept record. Open follow-ups move over.
        </>}
      />
      <MergeForm
        a={side(survivor)}
        b={side(merged)}
        fields={MERGE_FIELDS.map((f) => ({ key: f, label: LABELS[f] ?? f }))}
        defaults={defaultChoices(survivor, merged)}
        defaultsReversed={defaultChoices(merged, survivor)}
      />
      <Link href={`/leads/${survivor.id}`} className="btn-ghost">Cancel</Link>
    </div>
  );
}
