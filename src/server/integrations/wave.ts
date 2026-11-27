import { and, eq, notInArray } from "drizzle-orm";
import { withCtx, systemCtx } from "@/db/client";
import { financeContracts, integrationState, waveAccounts, waveInvoices } from "@/db/schema";
import { findProject, num, type WaveInvoiceNode } from "@/lib/wave";

/**
 * Wave (accounting) → Finance, read-only: copies the business's chart of accounts with current balances
 * (types drive the statements), and its invoices, each matched to its Goodshuffle contract by project number. Never creates or changes anything in Wave. Full re-read
 * each run (invoices are few), so edits and deletions in Wave show up on the next sync.
 */
const ENDPOINT = "https://gql.waveapps.com/graphql/public";
const STATE_KEY = "wave_sync";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export interface WaveAccountNode {
  id: string;
  name: string;
  displayId?: string | null;
  type: { value: string } | null;
  subtype: { value: string } | null;
  normalBalanceType?: string | null;
  isArchived?: boolean | null;
  /** Wave sends balances as decimal text */
  balanceInBusinessCurrency?: string | number | null;
  balance?: string | number | null;
}

export interface WaveClient {
  businesses(): Promise<{ id: string; name: string; isPersonal?: boolean; currency?: { code: string } | null }[]>;
  accounts(businessId: string, page: number, pageSize: number): Promise<{ totalPages: number; items: WaveAccountNode[] }>;
  invoices(businessId: string, page: number, pageSize: number): Promise<{ totalPages: number; items: WaveInvoiceNode[] }>;
}

export interface WaveState {
  lastRunAt?: string;
  lastError?: string | null;
  businessId?: string;
  businessName?: string;
  invoices?: number;
  matched?: number;
  accounts?: number;
}

export const waveConfigured = (env: Record<string, string | undefined> = process.env) => !!env.WAVE_ACCESS_TOKEN?.trim();

export function waveGraphqlClient(token: string, fetcher: typeof fetch = fetch): WaveClient {
  const gql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const r = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 401 || r.status === 403) throw new Error(`Wave refused the token (${r.status}): check WAVE_ACCESS_TOKEN`);
    const j = (await r.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] };
    if (!r.ok || j.errors?.length) throw new Error(`Wave API: ${j.errors?.[0]?.message ?? `HTTP ${r.status}`}`);
    return j.data as T;
  };
  return {
    async businesses() {
      const d = await gql<{ businesses: { edges: { node: { id: string; name: string; isPersonal: boolean; currency: { code: string } | null } }[] } }>(
        `query { businesses(page: 1, pageSize: 20) { edges { node { id name isPersonal currency { code } } } } }`,
      );
      return d.businesses.edges.map((e) => e.node);
    },
    async accounts(businessId, page, pageSize) {
      const d = await gql<{ business: { accounts: { pageInfo: { totalPages: number }; edges: { node: WaveAccountNode }[] } } | null }>(
        `query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
          business(id: $businessId) {
            accounts(page: $page, pageSize: $pageSize) {
              pageInfo { currentPage totalPages }
              edges { node { id name displayId type { value } subtype { value } normalBalanceType isArchived balance balanceInBusinessCurrency } }
            }
          }
        }`,
        { businessId, page, pageSize },
      );
      if (!d.business) throw new Error("Wave business not found: check WAVE_BUSINESS_ID");
      return { totalPages: d.business.accounts.pageInfo.totalPages, items: d.business.accounts.edges.map((e) => e.node) };
    },
    async invoices(businessId, page, pageSize) {
      const d = await gql<{ business: { invoices: { pageInfo: { totalPages: number }; edges: { node: WaveInvoiceNode }[] } } | null }>(
        `query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
          business(id: $businessId) {
            invoices(page: $page, pageSize: $pageSize) {
              pageInfo { currentPage totalPages totalCount }
              edges { node {
                id invoiceNumber status title subhead poNumber memo invoiceDate dueDate modifiedAt viewUrl
                customer { name } currency { code } total { raw value } amountDue { raw value }
              } }
            }
          }
        }`,
        { businessId, page, pageSize },
      );
      if (!d.business) throw new Error("Wave business not found: check WAVE_BUSINESS_ID");
      return { totalPages: d.business.invoices.pageInfo.totalPages, items: d.business.invoices.edges.map((e) => e.node) };
    },
  };
}

export async function getWaveState(orgId: string): Promise<WaveState> {
  const [row] = await withCtx(systemCtx(orgId), (tx) => tx.select().from(integrationState).where(and(eq(integrationState.orgId, orgId), eq(integrationState.key, STATE_KEY))));
  return (row?.value as WaveState) ?? {};
}
async function saveState(orgId: string, value: WaveState) {
  await withCtx(systemCtx(orgId), (tx) =>
    tx.insert(integrationState).values({ orgId, key: STATE_KEY, value, updatedAt: new Date() }).onConflictDoUpdate({ target: [integrationState.orgId, integrationState.key], set: { value, updatedAt: new Date() } }),
  );
}

/** Pick the business: WAVE_BUSINESS_ID if set, else the only (non-personal) business on the account. */
async function chooseBusiness(client: WaveClient, wanted?: string) {
  const all = await client.businesses();
  if (wanted) {
    const b = all.find((x) => x.id === wanted);
    if (!b) throw new Error("WAVE_BUSINESS_ID isn't one of this token's businesses");
    return b;
  }
  const real = all.filter((b) => !b.isPersonal);
  if (real.length === 1) return real[0];
  if (!real.length) throw new Error("No Wave business found for this token");
  throw new Error(`This Wave login has ${real.length} businesses: set WAVE_BUSINESS_ID to choose (${real.map((b) => b.name).join(", ")})`);
}

export async function runWaveSync(orgId: string, client: WaveClient, opts: { now?: Date; businessId?: string } = {}): Promise<WaveState> {
  const now = opts.now ?? new Date();
  const prev = await getWaveState(orgId);
  try {
    const business = await chooseBusiness(client, opts.businessId ?? process.env.WAVE_BUSINESS_ID?.trim() ?? undefined);
    const all: WaveInvoiceNode[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await client.invoices(business.id, page, PAGE_SIZE);
      all.push(...r.items);
      if (page >= r.totalPages) break;
    }
    const accounts: WaveAccountNode[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await client.accounts(business.id, page, PAGE_SIZE);
      accounts.push(...r.items);
      if (page >= r.totalPages) break;
    }
    const ctx = systemCtx(orgId);
    const dec = (v: string | number | null | undefined) => {
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
      return v != null && String(v).trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };
    await withCtx(ctx, async (tx) => {
      for (const a of accounts) {
        const vals = {
          businessId: business.id, name: a.name, displayId: a.displayId ?? null, type: (a.type?.value ?? "UNKNOWN").toUpperCase(),
          subtype: a.subtype?.value?.toUpperCase() ?? null, normalBalance: a.normalBalanceType ?? null, archived: !!a.isArchived,
          balance: dec(a.balanceInBusinessCurrency ?? a.balance), syncedAt: now,
        };
        await tx.insert(waveAccounts).values({ orgId, waveId: a.id, ...vals }).onConflictDoUpdate({ target: [waveAccounts.orgId, waveAccounts.waveId], set: vals });
      }
      const seen = accounts.map((a) => a.id);
      if (seen.length) await tx.delete(waveAccounts).where(notInArray(waveAccounts.waveId, seen));
    });
    let matched = 0;
    await withCtx(ctx, async (tx) => {
      const contracts = await tx.select({ id: financeContracts.id, project: financeContracts.project }).from(financeContracts);
      const byProject = new Map(contracts.map((c) => [c.project, c.id]));
      const known = new Set(byProject.keys());
      for (const inv of all) {
        const project = findProject(inv, known);
        const contractId = project ? byProject.get(project) ?? null : null;
        if (contractId) matched++;
        const vals = {
          businessId: business.id,
          invoiceNumber: inv.invoiceNumber,
          status: (inv.status ?? "UNKNOWN").toUpperCase(),
          title: inv.title,
          poNumber: inv.poNumber,
          invoiceDate: inv.invoiceDate?.slice(0, 10) ?? null,
          dueDate: inv.dueDate?.slice(0, 10) ?? null,
          customerName: inv.customer?.name ?? null,
          total: num(inv.total),
          amountDue: num(inv.amountDue),
          currency: inv.currency?.code ?? business.currency?.code ?? null,
          viewUrl: inv.viewUrl,
          project,
          contractId,
          waveModifiedAt: inv.modifiedAt ? new Date(inv.modifiedAt) : null,
          syncedAt: now,
        };
        await tx.insert(waveInvoices).values({ orgId, waveId: inv.id, ...vals }).onConflictDoUpdate({ target: [waveInvoices.orgId, waveInvoices.waveId], set: vals });
      }
      // deleted in Wave (or another business): drop our copy
      const seen = all.map((i) => i.id);
      if (seen.length) await tx.delete(waveInvoices).where(notInArray(waveInvoices.waveId, seen));
      else await tx.delete(waveInvoices);
    });
    const state: WaveState = { lastRunAt: now.toISOString(), lastError: null, businessId: business.id, businessName: business.name, invoices: all.length, matched, accounts: accounts.length };
    await saveState(orgId, state);
    return state;
  } catch (e) {
    await saveState(orgId, { ...prev, lastRunAt: now.toISOString(), lastError: (e as Error).message });
    throw e;
  }
}

/**
 * What Wave's API offers (schema names only, no business data): the fields on Business and the
 * query/mutation names that mention transactions. For checking what can be synced.
 */
export async function inspectWaveSchema(token: string, fetcher: typeof fetch = fetch) {
  const q = `query {
    business: __type(name: "Business") { fields { name args { name } type { name kind ofType { name kind ofType { name } } } } }
    query: __schema { queryType { fields { name } } mutationType { fields { name } } }
  }`;
  const r = await fetcher(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const j = (await r.json()) as any;
  if (j.errors?.length) return { error: j.errors[0].message };
  const fields = (j.data.business?.fields ?? []).map((f: any) => `${f.name}(${(f.args ?? []).map((a: any) => a.name).join(",")})`);
  const muts = (j.data.query?.mutationType?.fields ?? []).map((f: any) => f.name);
  return {
    businessFields: fields,
    rootQueries: (j.data.query?.queryType?.fields ?? []).map((f: any) => f.name),
    transactionMutations: muts.filter((m: string) => /transaction/i.test(m)),
  };
}
