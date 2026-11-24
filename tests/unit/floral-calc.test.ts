import { describe, it, expect } from "vitest";
import { buildOrder, orderCsv, FLORAL_HINT } from "@/lib/floral-calc";

const stems = [
  { id: "rose", name: "Garden rose, white", perBunch: 12 },
  { id: "euc", name: "Eucalyptus, silver dollar", perBunch: 10 },
  { id: "ran", name: "Ranunculus, blush", perBunch: 10 },
];
const bouquet = [{ stemId: "rose", qty: 10 }, { stemId: "euc", qty: 3 }, { stemId: "ran", qty: 5 }];
const centre = [{ stemId: "rose", qty: 5 }, { stemId: "euc", qty: 4 }];

describe("wholesale order", () => {
  const rows = buildOrder(
    [
      { eventId: "e1", eventName: "Rossi Wedding", eventDate: "2026-12-05", label: "Bridal bouquet", qty: 1, stems: bouquet },
      { eventId: "e1", eventName: "Rossi Wedding", eventDate: "2026-12-05", label: "Centrepiece", qty: 12, stems: centre },
      { eventId: "e2", eventName: "Patel Gala", eventDate: "2026-12-03", label: "Extra roses", qty: 7, stems: [{ stemId: "rose", qty: 1 }] },
    ],
    stems,
    10,
  );
  it("adds up recipe × quantity across events, adds the buffer and rounds up to whole bunches", () => {
    const rose = rows.find((r) => r.stemId === "rose")!;
    // 10 + 5×12 + 7 = 77 → +10% = 84.7 → 85 → 8 bunches of 12 = 96
    expect(rose).toMatchObject({ needed: 77, withBuffer: 85, bunches: 8, ordered: 96 });
    expect(rose.byEvent.map((e) => [e.eventName, e.needed])).toEqual([["Patel Gala", 7], ["Rossi Wedding", 70]]);
    const euc = rows.find((r) => r.stemId === "euc")!;
    // 3 + 4×12 = 51 → 56.1 → 57 → 6 bunches = 60
    expect(euc).toMatchObject({ needed: 51, withBuffer: 57, bunches: 6, ordered: 60 });
  });
  it("no buffer: exact multiples stay exact", () => {
    const r = buildOrder([{ eventId: "e", eventName: "x", eventDate: "2026-12-01", label: "x", qty: 2, stems: [{ stemId: "ran", qty: 5 }] }], stems, 0);
    expect(r[0]).toMatchObject({ needed: 10, withBuffer: 10, bunches: 1, ordered: 10 });
  });
  it("sorted by stem name; CSV has one row per stem", () => {
    expect(rows.map((r) => r.name)).toEqual(["Eucalyptus, silver dollar", "Garden rose, white", "Ranunculus, blush"]);
    const csv = orderCsv(rows).split("\n");
    expect(csv.length).toBe(4);
    expect(csv[2]).toMatch(/^"Garden rose, white",77,85,12,8,96,/);
  });
  it("spots floral lines in Goodshuffle packages", () => {
    expect(FLORAL_HINT.test("Personal Fresh Flowers Styling")).toBe(true);
    expect(FLORAL_HINT.test("Standard Delivery Package Pickup")).toBe(false);
  });
});
