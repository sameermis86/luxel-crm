import { describe, it, expect } from "vitest";
import { guessMapping, parseMoney, parseDate, mapFinanceRow } from "@/lib/finance";

describe("finance import parsing", () => {
  it("reads money the way Goodshuffle exports it", () => {
    expect(parseMoney("$12,345.67")).toBe(12345.67);
    expect(parseMoney("CA$ 1,200")).toBe(1200);
    expect(parseMoney("(250.00)")).toBe(-250);
    expect(parseMoney("-80")).toBe(-80);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
  });
  it("reads common date formats, month first for slashes", () => {
    expect(parseDate("2027-06-12")).toBe("2027-06-12");
    expect(parseDate("6/12/2027")).toBe("2027-06-12");
    expect(parseDate("Jun 12, 2027 4:00 PM")).toBe("2027-06-12");
    expect(parseDate("Saturday, June 12, 2027")).toBe("2027-06-12");
    expect(parseDate("12 June 2027")).toBe("2027-06-12");
    expect(parseDate("13/45/2027")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
  it("guesses columns and maps a row; balance falls back to total minus paid", () => {
    const headers = ["Project #", "Project Name", "Client", "Event Date", "Status", "Grand Total", "Amount Paid", "Notes"];
    const m = guessMapping(headers);
    expect(m).toMatchObject({ project: "Project #", name: "Project Name", client: "Client", eventDate: "Event Date", status: "Status", total: "Grand Total", paid: "Amount Paid" });
    const r = mapFinanceRow({ "Project #": "#1048207", "Grand Total": "$9,040.00", "Amount Paid": "$2,712.00", "Event Date": "6/12/2027", Client: "Sofia Rossi" }, m);
    expect(r).toEqual({ ok: true, row: { project: "1048207", total: 9040, paid: 2712, balance: 6328, client: "Sofia Rossi", name: null, eventDate: "2027-06-12", status: null } });
    expect(mapFinanceRow({ "Project #": "", "Grand Total": "1" }, m)).toEqual({ ok: false, error: "No project number" });
  });
});

describe("Goodshuffle project list export", () => {
  const headers = ["Project ID", "Status", "Project Name", "Client Name", "Internal Contract Notes", "Quote Total", "Event Start Date", "Event Start Time", "Venue", "Contract Total", "Amount Due"];
  const m = guessMapping(headers);
  it("maps its columns (contract total, not quote total; amount due as balance)", () => {
    expect(m).toMatchObject({ project: "Project ID", status: "Status", name: "Project Name", client: "Client Name", eventDate: "Event Start Date", total: "Contract Total", balance: "Amount Due" });
    expect(m.paid).toBeUndefined();
  });
  it("keeps signed contracts (paid = total - amount due) and leaves out quotes and lost projects", () => {
    const row = (status: string, contract: string, due: string) => ({ "Project ID": "123456789", Status: status, "Contract Total": contract, "Amount Due": due, "Quote Total": "$9,999.00 CAD ", "Event Start Date": "06/12/2027" });
    expect(mapFinanceRow(row("Contract Signed", "$9,040.00 CAD ", "$1,000.00 CAD "), m)).toMatchObject({ ok: true, row: { total: 9040, paid: 8040, balance: 1000, eventDate: "2027-06-12" } });
    expect(mapFinanceRow(row("Unsigned Changes", "$500.00 CAD", "$0.00 CAD"), m).ok).toBe(true);
    expect(mapFinanceRow(row("Lost", "$316.50 CAD", "$0.00 CAD"), m)).toMatchObject({ ok: false, notContract: true });
    expect(mapFinanceRow(row("Quote Sent", "$0.00 CAD", "$0.00 CAD"), m)).toMatchObject({ ok: false, notContract: true });
  });
});
