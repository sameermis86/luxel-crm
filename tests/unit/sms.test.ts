import { describe, it, expect } from "vitest";
import { renderSms, smsEligibility, smsHref, textable, STOP_LINE, type SmsLead } from "@/lib/sms";

const now = new Date("2026-11-24T15:00:00Z");
const s = { senderName: "Mansi from Luxel Decor", consentDays: 183, minDaysBetween: 3, templates: [] };
const lead = (over: Partial<SmsLead> = {}): SmsLead => ({
  firstName: "Sofia", phoneE164: "+14165550123", status: "contacted", createdAt: new Date("2026-10-01T15:00:00Z"),
  smsOptOutAt: null, eventType: "wedding", eventDate: "2027-06-12", venueName: "Hazelton Manor", ...over,
});

describe("sms rules", () => {
  it("fills the template, names the sender and adds the opt-out line", () => {
    const t = renderSms("Hi {first_name}, it's {sender}. About your {event}{event_date}{venue}?", lead(), s);
    expect(t).toBe(`Hi Sofia, it's Mansi from Luxel Decor. About your wedding on June 12 at Hazelton Manor? ${STOP_LINE}`);
    expect(renderSms("Hi {first_name}! Reply STOP to stop.", lead({ firstName: null, eventDate: null }), s)).toBe("Hi there! Reply STOP to stop. – Mansi from Luxel Decor");
  });
  it("only within CASL consent, never after an opt-out, not to closed leads, not too often", () => {
    expect(smsEligibility(lead(), now, s, null)).toEqual({ ok: true });
    expect(smsEligibility(lead({ createdAt: new Date("2026-04-01T15:00:00Z") }), now, s, null).ok).toBe(false);
    expect(smsEligibility(lead({ smsOptOutAt: now }), now, s, null)).toMatchObject({ ok: false, reason: "Asked not to be texted" });
    expect(smsEligibility(lead({ status: "won" }), now, s, null).ok).toBe(false);
    expect(smsEligibility(lead({ phoneE164: null }), now, s, null).ok).toBe(false);
    expect(smsEligibility(lead(), now, s, new Date("2026-11-23T15:00:00Z"))).toMatchObject({ ok: false });
    expect(smsEligibility(lead(), now, s, new Date("2026-11-20T15:00:00Z")).ok).toBe(true);
  });
  it("builds an sms: link that iPhone Messages fills in", () => {
    expect(smsHref("+14165550123", "Hi & bye")).toBe("sms:+14165550123?&body=Hi%20%26%20bye");
    expect(textable("+14165550123")).toBe(true);
    expect(textable("+442071234567")).toBe(false);
  });
});
