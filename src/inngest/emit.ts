import { inngest } from "./client";

export type JobEvent = "lead/created" | "import/completed";

/**
 * Fire a background-job event. A no-op unless Inngest is configured
 * (INNGEST_EVENT_KEY in prod, or INNGEST_DEV=1 with `pnpm inngest:dev` locally),
 * so tests and a bare `pnpm dev` work without it.
 */
export async function emitJob(name: JobEvent, data: Record<string, unknown>) {
  if (!process.env.INNGEST_EVENT_KEY && process.env.INNGEST_DEV !== "1") return;
  try {
    await inngest.send({ name, data });
  } catch (err) {
    console.error(`[inngest] failed to send ${name}`, err);
  }
}
