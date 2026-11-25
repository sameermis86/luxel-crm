import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withPage } from "@/server/page";
import { PageHeader } from "@/components/page-header";
import { FinanceImportForm } from "./import-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import contracts" };

export default async function FinanceImportPage() {
  await withPage(async () => ({}), "finance:manage");
  return (
    <div className="space-y-5">
      <Link href="/finance" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Finance</Link>
      <PageHeader eyebrow="Finance" title="Import contracts from Goodshuffle" description="Upload a Goodshuffle report exported as CSV. Each project is matched to its lead by project number." />
      <FinanceImportForm />
    </div>
  );
}
