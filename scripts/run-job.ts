import "dotenv/config";
import { closeDb } from "@/db/client";
import { resolveOrgId } from "@/server/org";
import { runNightly, sendDailyDigests } from "@/server/jobs";

/** Run a scheduled job by hand (no Inngest needed): pnpm job digest | pnpm job nightly */
const job = process.argv[2];
(async () => {
  const orgId = await resolveOrgId();
  if (!orgId) throw new Error("org not found; run pnpm db:seed");
  if (job === "digest") console.log(await sendDailyDigests(orgId));
  else if (job === "nightly") console.log(await runNightly(orgId));
  else console.log("usage: pnpm job digest|nightly");
  await closeDb();
})();
