import { describe, it, expect } from "vitest";
import { findProject, isInvoiced, num } from "@/lib/wave";

describe("wave invoices", () => {
  const known = new Set(["104820712", "200000001"]);
  it("finds the Goodshuffle project number, PO number first, preferring one we know", () => {
    expect(findProject({ poNumber: "104820712", title: null, memo: null }, known)).toBe("104820712");
    expect(findProject({ poNumber: null, title: "Rossi wedding #200000001 deposit", memo: null }, known)).toBe("200000001");
    expect(findProject({ poNumber: "PO 555555555", title: "Project 104820712", memo: null }, known)).toBe("104820712");
    expect(findProject({ poNumber: null, title: "Deposit", memo: "see 987654321" }, known)).toBe("987654321");
    expect(findProject({ poNumber: null, title: "Invoice for $12,500.00 on 2027-06-12", memo: null }, known)).toBeNull();
  });
  it("drafts aren't invoiced revenue; money values are strings", () => {
    expect(isInvoiced("DRAFT")).toBe(false);
    expect(isInvoiced("paid")).toBe(true);
    expect(num({ value: "1234.567" })).toBe(1234.57);
    expect(num({ value: "12,345.60" })).toBe(12345.6); // display text has thousands separators
    expect(num({ raw: 1234560, value: "12,345.60" })).toBe(12345.6); // cents win
    expect(num({ value: "" })).toBeNull();
    expect(num(null)).toBeNull();
  });
});
