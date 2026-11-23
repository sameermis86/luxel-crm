import type { Source } from "@/db/schema";
import type { Settings } from "./config/defaults";

export type IntakeForm = "quote_builder" | "contact_us";

export interface SourceInput {
  explicitSource?: Source | null;
  explicitChannel?: Source | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  referrerUrl?: string | null;
  form?: IntakeForm | null;
}

export interface ResolvedSource {
  source: Source; // origin: what brought them
  captureChannel: Source | null; // how they reached us
  rule: "explicit" | "utm" | "referrer" | "form" | "fallback";
}

const OWN_DOMAINS = ["luxeldecor.com", "wixsite.com", "wix.com", "luxeldecor.ca"];
const FORM_CHANNEL: Record<IntakeForm, Source> = { quote_builder: "quote_builder", contact_us: "contact_us_form" };

function hostOf(url: string): string | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Resolution order: explicit → UTM → referrer domain → form → other. */
export function resolveSource(input: SourceInput, settings: Pick<Settings, "utmRules" | "referrerRules">): ResolvedSource {
  const channel: Source | null = input.explicitChannel ?? (input.form ? FORM_CHANNEL[input.form] : null);

  if (input.explicitSource) return { source: input.explicitSource, captureChannel: channel, rule: "explicit" };

  const us = input.utmSource?.trim().toLowerCase();
  const um = input.utmMedium?.trim().toLowerCase() ?? "";
  if (us || um) {
    const hit = settings.utmRules.find(
      (r) => (r.source === "*" || r.source === us) && (r.medium === "*" || r.medium === um),
    );
    if (hit) return { source: hit.result, captureChannel: channel, rule: "utm" };
  }

  if (input.referrerUrl) {
    const host = hostOf(input.referrerUrl);
    if (host && !OWN_DOMAINS.some((d) => host === d || host.endsWith("." + d))) {
      const bare = host.replace(/^www\./, "");
      const hit = settings.referrerRules.find((r) => bare === r.domain || bare.startsWith(r.domain) || bare.endsWith("." + r.domain));
      if (hit) return { source: hit.result, captureChannel: channel, rule: "referrer" };
    }
  }

  if (input.form) return { source: FORM_CHANNEL[input.form], captureChannel: channel, rule: "form" };
  return { source: "other", captureChannel: channel, rule: "fallback" };
}
