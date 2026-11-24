import { describe, it, expect } from "vitest";
import { parseIcs, matchEvent, plannedStatus, extractContacts, type CandidateLead } from "@/lib/goodshuffle";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:gs-1@goodshuffle",
  "DTSTART;VALUE=DATE:20270612",
  "SUMMARY:Rossi / Bianchi Wedding",
  "DESCRIPTION:Client: Sofia Rossi\\nVenue: Paradise Banquet Hall\\nStatus: Signed",
  "LOCATION:Paradise Banquet Hall\\, Vaughan",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:gs-2@goodshuffle",
  "DTSTART:20270905T013000Z",
  "SUMMARY:Patel Gala - long title that is fol",
  " ded onto the next line",
  "DESCRIPTION:Contact priya@example.com (416) 555-0199",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:gs-3@goodshuffle",
  "DTSTART;TZID=America/Toronto:20270710T150000",
  "SUMMARY:Kim Shower",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("reads events, unfolds lines, unescapes text and resolves dates in Toronto", () => {
    const evs = parseIcs(ICS);
    expect(evs.map((e) => e.uid)).toEqual(["gs-1@goodshuffle", "gs-2@goodshuffle", "gs-3@goodshuffle"]);
    expect(evs[0]).toMatchObject({ startDate: "2027-06-12", summary: "Rossi / Bianchi Wedding", location: "Paradise Banquet Hall, Vaughan" });
    expect(evs[0].description).toContain("Client: Sofia Rossi\nVenue");
    expect(evs[1].summary).toBe("Patel Gala - long title that is folded onto the next line");
    expect(evs[1].startDate).toBe("2027-09-04"); // 01:30 UTC = 9:30 pm the evening before in Toronto
    expect(evs[2].startDate).toBe("2027-07-10");
  });
  it("finds contacts in event text", () => {
    expect(extractContacts("Contact Priya@Example.com or (416) 555-0199")).toEqual({ emails: ["priya@example.com"], phones: ["+14165550199"] });
  });
});

const L = (o: Partial<CandidateLead>): CandidateLead => ({ id: "x", firstName: null, lastName: null, partnerName: null, emailNormalized: null, phoneE164: null, eventDate: null, ...o });
const leads = [
  L({ id: "rossi", firstName: "Sofia", lastName: "Rossi", partnerName: "Marco Bianchi", eventDate: "2027-06-12" }),
  L({ id: "patel", firstName: "Priya", lastName: "Patel", emailNormalized: "priya@example.com", eventDate: "2027-09-04" }),
  L({ id: "kim1", firstName: "Emma", lastName: "Kim", eventDate: "2027-07-10" }),
  L({ id: "kim2", firstName: "Grace", lastName: "Kim", eventDate: "2027-07-10" }),
  L({ id: "other", firstName: "Ana", lastName: "Lopez", eventDate: "2027-06-12" }),
];

describe("matchEvent", () => {
  const evs = parseIcs(ICS);
  it("email or phone in the event wins", () => {
    expect(matchEvent(evs[1], leads)).toMatchObject({ leadId: "patel", how: "contact" });
  });
  it("same event date + name", () => {
    expect(matchEvent(evs[0], leads)).toMatchObject({ leadId: "rossi", how: "date_and_name" });
  });
  it("tolerates a one-day offset (setup day)", () => {
    expect(matchEvent({ ...evs[0], startDate: "2027-06-11" }, leads).leadId).toBe("rossi");
  });
  it("two leads with the same surname and date go to review, not a guess", () => {
    expect(matchEvent(evs[2], leads)).toMatchObject({ leadId: null, reason: "More than one lead could match" });
  });
  it("no lead on that date", () => {
    expect(matchEvent({ ...evs[0], startDate: "2028-01-01" }, leads)).toMatchObject({ leadId: null, reason: "No lead with that event date" });
  });
});

describe("plannedStatus (forward only)", () => {
  it("quote sent moves early leads to proposal sent, never backwards", () => {
    expect(plannedStatus("contacted", "quote_sent")).toBe("proposal_sent");
    expect(plannedStatus("consult_held", "quote_sent")).toBe("proposal_sent");
    expect(plannedStatus("proposal_sent", "quote_sent")).toBeNull();
    expect(plannedStatus("won", "quote_sent")).toBeNull();
  });
  it("signed / action needed = won", () => {
    expect(plannedStatus("proposal_sent", "signed")).toBe("won");
    expect(plannedStatus("new", "action_needed")).toBe("won");
    expect(plannedStatus("won", "signed")).toBeNull();
  });
  it("lost marks the lead lost; Goodshuffle never reopens a lost lead", () => {
    expect(plannedStatus("proposal_sent", "lost")).toBe("lost");
    expect(plannedStatus("lost", "signed")).toBeNull();
  });
  it("new changes nothing; unqualified leads are left alone", () => {
    expect(plannedStatus("contacted", "new")).toBeNull();
    expect(plannedStatus("unqualified", "signed")).toBeNull();
  });
});
