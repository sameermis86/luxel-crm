import { describe, it, expect } from "vitest";
import { resolveSource } from "@/lib/source";
import { DEFAULT_SETTINGS } from "@/lib/config/defaults";

const s = DEFAULT_SETTINGS;
describe("resolveSource", () => {
  it("1. explicit source wins", () => {
    expect(resolveSource({ explicitSource: "referral", utmSource: "google", utmMedium: "cpc" }, s).source).toBe("referral");
  });
  it("2. utm mapping", () => {
    expect(resolveSource({ utmSource: "google", utmMedium: "cpc", form: "quote_builder" }, s)).toEqual({
      source: "google_ads", captureChannel: "quote_builder", rule: "utm",
    });
    expect(resolveSource({ utmSource: "Instagram", utmMedium: "story" }, s).source).toBe("instagram");
    expect(resolveSource({ utmSource: "gbp" }, s).source).toBe("google_business_profile");
    expect(resolveSource({ utmSource: "facebook", utmMedium: "paid_social" }, s).source).toBe("facebook");
  });
  it("3. referrer domain when no UTM", () => {
    expect(resolveSource({ referrerUrl: "https://www.google.com/", form: "contact_us" }, s).source).toBe("organic_search");
    expect(resolveSource({ referrerUrl: "https://www.google.ca/search?q=florist" }, s).source).toBe("organic_search");
    expect(resolveSource({ referrerUrl: "https://l.instagram.com/?u=x" }, s).source).toBe("instagram");
  });
  it("own-site referrers are ignored", () => {
    expect(resolveSource({ referrerUrl: "https://www.luxeldecor.com/weddings", form: "contact_us" }, s).source).toBe("contact_us_form");
  });
  it("4. the form it came from", () => {
    expect(resolveSource({ form: "quote_builder" }, s)).toEqual({ source: "quote_builder", captureChannel: "quote_builder", rule: "form" });
    expect(resolveSource({ form: "contact_us" }, s).source).toBe("contact_us_form");
  });
  it("5. other", () => expect(resolveSource({}, s)).toEqual({ source: "other", captureChannel: null, rule: "fallback" }));
  it("unknown utm falls through to referrer / form", () => {
    expect(resolveSource({ utmSource: "mystery", utmMedium: "x", form: "quote_builder" }, s).source).toBe("quote_builder");
  });
  it("explicit channel is kept separate from origin", () => {
    expect(resolveSource({ explicitSource: "instagram", explicitChannel: "phone" }, s)).toEqual({
      source: "instagram", captureChannel: "phone", rule: "explicit",
    });
  });
});
