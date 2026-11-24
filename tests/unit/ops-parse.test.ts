import { describe, it, expect } from "vitest";
import { buildTasks, parseProject } from "@/lib/ops-parse";

import { SAMPLE } from "../fixtures/goodshuffle-sample";

describe("parseProject", () => {
  const p = parseProject({ summary: "Rossi Wedding", description: SAMPLE });
  it("reads the header, notes and links", () => {
    expect(p).toMatchObject({ project: "231716065", name: "Rossi - Kortright Wedding", client: "Sofia Rossi", venue: "Kortright Centre", salesLead: "Mansi", timeText: "Saturday, 11/6 [10:00 am] - Sunday, 11/7 [1:00 am]" });
    expect(p.notesInternal).toBe("IS the CEREMONY onsite?\nno more than 4k");
    expect(p.notesClient).toBe("Theme: Ivory/Greenery");
    expect(p.links.pullsheetByGroup).toContain("pullsheet?vuuid=abc&s=g"); // the Printed link, not Digital
    expect(p.links.project).toContain("detail?id=231716065");
  });
  it("groups items by area (dates and 'Top-level only' trimmed) with quantities", () => {
    expect(p.areas).toEqual(["Head Table", "12 Guest Tables", "Lobby", "Logistics"]);
    expect(p.items.find((i) => i.name.startsWith("Crystal"))).toEqual({ area: "Lobby", name: "Crystal Holder - Tall Candles - Set of 3", qty: 2, logistics: false });
    expect(p.items.filter((i) => i.logistics).length).toBe(3);
  });
  it("builds setup/teardown per decor area, and sorts logistics by drop-off vs pickup", () => {
    const t = buildTasks(p, { setup: ["Set up {area}"], teardown: ["Strike {area}"] });
    expect(t.filter((x) => x.phase === "setup" && x.area !== "Logistics").map((x) => x.title)).toEqual(["Set up Head Table", "Set up 12 Guest Tables", "Set up Lobby"]);
    const log = t.filter((x) => x.area === "Logistics");
    expect(log.map((x) => [x.phase, x.title])).toEqual([
      ["setup", "Standard Delivery Package Drop-Off"],
      ["setup", "Ceremony Delivery and Teardown Within 15kms Drop-Off"],
      ["teardown", "Standard Delivery Package Pickup"],
    ]);
  });
});
