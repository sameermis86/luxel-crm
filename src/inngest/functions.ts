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

/** 02:15 Toronto: rescore open leads (timing decays) + nightly duplicate scan. */
export const nightly = inngest.createFunction(
  { id: "nightly-rescore-and-dedupe", retries: 1 },
  { cron: "TZ=America/Toronto 15 2 * * *" },
  async ({ step }) => {
    const orgId = await step.run("resolve-org", resolveOrgId);
    if (!orgId) return { skipped: "no org" };
    return step.run("rescore-and-dedupe", () => runNightly(orgId));
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

export const functions = [dailyDigest, nightly, leadCreated];
