import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withCtx, closeDb, type Ctx } from "@/db/client";
import { waveInvoices } from "@/db/schema";
import { importContracts, financeOverview, waveBalances } from "@/server/finance";
import { runWaveSync, getWaveState, waveGraphqlClient, type WaveClient } from "@/server/integrations/wave";
import type { WaveInvoiceNode } from "@/lib/wave";
import { freshOrg } from "../helpers";

let env: Awaited<ReturnType<typeof freshOrg>>;
let owner: Ctx;
const inv = (id: string, over: Partial<WaveInvoiceNode>): WaveInvoiceNode => ({
  id, invoiceNumber: id, status: "SENT", title: null, subhead: null, poNumber: null, memo: null, invoiceDate: "2027-01-15", dueDate: null,
  modifiedAt: "2026-11-20T10:00:00Z", viewUrl: null, customer: { name: "Client" }, currency: { code: "CAD" }, total: { value: "1000.00" }, amountDue: { value: "0" }, ...over,
});
let book: WaveInvoiceNode[] = [];
const client: WaveClient = {
  accounts: async () => ({ totalPages: 1, items: [
    { id: "a1", name: "Chequing", type: { value: "ASSET" }, subtype: { value: "CASH_AND_BANK" }, normalBalanceType: "DEBIT", balanceInBusinessCurrency: "12,345.67" },
    { id: "a2", name: "Decor rentals", type: { value: "INCOME" }, subtype: { value: "INCOME" }, normalBalanceType: "CREDIT", balanceInBusinessCurrency: "500" },
  ] }),
  businesses: async () => [{ id: "b1", name: "Luxel Decor", isPersonal: false, currency: { code: "CAD" } }, { id: "p1", name: "Personal", isPersonal: true }],
  invoices: async (_b, page, size) => ({ totalPages: Math.max(1, Math.ceil(book.length / size)), items: book.slice((page - 1) * size, page * size) }),
};

beforeAll(async () => {
  env = await freshOrg();
  owner = { orgId: env.orgId, userId: env.sameer.id, role: "owner", actorKind: "user" };
  await importContracts(owner, {
    rows: [
      { project: "104820712", total: 9040, paid: null, balance: null, client: "Rossi", name: null, eventDate: "2027-06-12", status: "Contract Signed" },
      { project: "200000001", total: 5000, paid: null, balance: null, client: "Chen", name: null, eventDate: "2027-09-18", status: "Contract Signed" },
    ],
    skipped: 0, filename: null, mapping: {},
  });
});
afterAll(closeDb);

describe("wave sync", () => {
  it("copies invoices, matches them to contracts by project number, ignores drafts in totals", async () => {
    book = [
      inv("1", { poNumber: "104820712", total: { value: "2712.00" } }), // deposit
      inv("2", { title: "Final 104820712", total: { value: "6328.00" }, invoiceDate: "2027-06-01" }),
      inv("3", { poNumber: "999999999", total: { value: "500.00" } }), // a number we don't know
      inv("4", { poNumber: "200000001", status: "DRAFT", total: { value: "5000.00" } }), // draft: not invoiced yet
    ];
    const s = await runWaveSync(env.orgId, client, { now: new Date("2026-11-26T12:00:00Z") });
    expect(s).toMatchObject({ businessName: "Luxel Decor", invoices: 4, matched: 3, accounts: 2, lastError: null });
    const { waveAccounts } = await import("@/db/schema");
    const accts = await withCtx(owner, (tx) => tx.select().from(waveAccounts));
    expect(accts.find((a) => a.name === "Chequing")).toMatchObject({ type: "ASSET", subtype: "CASH_AND_BANK", balance: 12345.67 });

    const o = await withCtx(owner, (tx) => financeOverview(tx, "2027-01-01", "2028-01-01", "2026-11-26"));
    const rossi = o.list.find((x) => x.c.project === "104820712")!.c.id;
    const chen = o.list.find((x) => x.c.project === "200000001")!.c.id;
    expect(o.wave.invoicedBy.get(rossi)).toEqual({ contractId: rossi, total: 9040, count: 2 });
    expect(o.wave.invoicedBy.get(chen)).toBeUndefined(); // only a draft
    expect(o.wave.year).toEqual({ total: 9540, count: 3 });
    expect(o.wave.unmatched.map((u) => u.invoiceNumber)).toEqual(["3"]);
  });

  it("drops invoices deleted in Wave and keeps the last good numbers when a sync fails", async () => {
    book = book.filter((b) => b.id !== "3");
    await runWaveSync(env.orgId, client);
    expect((await withCtx(owner, (tx) => tx.select().from(waveInvoices))).map((r) => r.waveId).sort()).toEqual(["1", "2", "4"]);

    const bad = waveGraphqlClient("nope", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    await expect(runWaveSync(env.orgId, bad)).rejects.toThrow(/refused the token/);
    const st = await getWaveState(env.orgId);
    expect(st).toMatchObject({ invoices: 3, lastError: expect.stringMatching(/401/) });
  });

  it("asks for WAVE_BUSINESS_ID when a login has several businesses", async () => {
    const two: WaveClient = { ...client, businesses: async () => [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
    await expect(runWaveSync(env.orgId, two)).rejects.toThrow(/WAVE_BUSINESS_ID/);
    await runWaveSync(env.orgId, { ...two, invoices: client.invoices }, { businessId: "b" });
  });

  it("keeps one balance snapshot per account per day (the day's last), and shows the change since a week ago", async () => {
    const { waveBalanceSnapshots } = await import("@/db/schema");
    let cash = "1000.00";
    const c2: WaveClient = { ...client, accounts: async () => ({ totalPages: 1, items: [
      { id: "a1", name: "Chequing", type: { value: "ASSET" }, subtype: { value: "CASH_AND_BANK" }, balanceInBusinessCurrency: cash },
      { id: "t1", name: "Transfer clearing", type: { value: "ASSET" }, subtype: { value: "TRANSFERS" }, balanceInBusinessCurrency: "5" },
    ] }) };
    await runWaveSync(env.orgId, c2, { now: new Date("2026-11-20T15:00:00Z") }); // Nov 20, Toronto
    cash = "1500.00";
    await runWaveSync(env.orgId, c2, { now: new Date("2026-11-20T20:00:00Z") }); // same day: overwrites
    cash = "4000.00";
    await runWaveSync(env.orgId, c2, { now: new Date("2026-11-27T15:00:00Z") }); // a week later
    const snaps = await withCtx(owner, (tx) => tx.select().from(waveBalanceSnapshots));
    const on = (d: string) => snaps.filter((x) => x.waveId === "a1" && String(x.day) === d).map((x) => x.balance);
    expect(on("2026-11-20")).toEqual([1500]); // one row for the day: the later sync's value
    expect(on("2026-11-27")).toEqual([4000]);

    const b = await withCtx(owner, (tx) => waveBalances(tx, "2026-11-27"));
    const g = b.groups.find((x) => x.subtype === "CASH_AND_BANK")!;
    expect(g).toMatchObject({ total: 4000, week: 1500, month: null });
    expect(b.groups.some((x) => x.subtype === "TRANSFERS")).toBe(false); // Wave's internal transfer accounts are hidden
    expect(b.cashTrend.filter((d) => d.day === "2026-11-20" || d.day === "2026-11-27")).toEqual([{ day: "2026-11-20", total: 1500 }, { day: "2026-11-27", total: 4000 }]);
  });
});
