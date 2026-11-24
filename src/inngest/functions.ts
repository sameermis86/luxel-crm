import { inngest } from "./client";
import { resolveOrgId } from "@/server/org";
import { runNightly, sendDailyDigests } from "@/server/jobs";

/** Daily digest at 08:00 Toronto time (DST handled by the TZ prefix). */
export const dailyDigest = inngest.createFunction(
  { id: "daily-digest", retries: 2 },
  { cron: "TZ=America/Toronto 0 8 * * *" },
  async ({ step }) => {
    const orgId = await step.run("resolve-org", resolveOrgId);
    if (!orgId) return { skipped: "no org" };
    return step.run("send-digests", () => sendDailyDigests(orgId));
  },
);

/** 02:15 Toronto: recheck open leads' qualification + nightly duplicate scan. */
export const nightly = inngest.createFunction(
  { id: "nightly-requalify-and-dedupe", retries: 1 },
  { cron: "TZ=America/Toronto 15 2 * * *" },
  async ({ step }) => {
    const orgId = await step.run("resolve-org", resolveOrgId);
    if (!orgId) return { skipped: "no org" };
    return step.run("requalify-and-dedupe", () => runNightly(orgId));
  },
);

/**
 * Hook for slower post-intake work. Assignment emails already go out after
 * commit; this is where SMS (Twilio) or Slack alerts would go.
 */
export const leadCreated = inngest.createFunction(
  { id: "lead-created-followups" },
  { event: "lead/created" },
  async ({ event }) => ({ received: event.data.leadId }),
);

/** Every 15 minutes: pull new Wix Forms + Quote Builder leads (no-op until WIX_API_KEY is set). */
export const wixSync = inngest.createFunction(
  { id: "wix-sync", retries: 1, concurrency: { limit: 1 } },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const apiKey = process.env.WIX_API_KEY;
    const siteId = process.env.WIX_SITE_ID;
    if (!apiKey || !siteId) return { skipped: "WIX_API_KEY / WIX_SITE_ID not set" };
    const orgId = await step.run("resolve-org", resolveOrgId);
    if (!orgId) return { skipped: "no org" };
    const { runWixSync, wixRestClient } = await import("@/server/intake/wix-sync");
    return step.run("sync", () => runWixSync(orgId, wixRestClient(apiKey, siteId)));
  },
);

export const functions = [dailyDigest, nightly, leadCreated, wixSync];
