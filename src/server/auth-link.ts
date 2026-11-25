import "server-only";

/** Did this session come from an invite / reset email in the last 30 minutes? (then no current password needed) */
export async function arrivedByLink(): Promise<boolean> {
  const { createSupabaseServer } = await import("@/server/supabase");
  const { data } = await (await createSupabaseServer()).auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { amr?: { method: string; timestamp: number }[] };
    return (payload.amr ?? []).some((a) => ["recovery", "invite", "otp", "magiclink"].includes(a.method) && Date.now() / 1000 - a.timestamp < 1800);
  } catch {
    return false;
  }
}

