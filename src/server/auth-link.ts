import "server-only";

/** Did this session come from an invite / reset email in the last 30 minutes? (then no current password needed) */
export async function arrivedByLink(): Promise<boolean> {
  const { createSupabaseServer } = await import("@/server/supabase");
  const supabase = await createSupabaseServer();
  // set by /api/auth/confirm when an invite / reset link was used in this browser
  const { cookies } = await import("next/headers");
  const { PWLINK_COOKIE, pwLinkValid } = await import("@/lib/session-cookie");
  const { data: u } = await supabase.auth.getUser();
  if (u.user && (await pwLinkValid((await cookies()).get(PWLINK_COOKIE)?.value, u.user.id))) return true;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { amr?: { method: string; timestamp: number }[] };
    return (payload.amr ?? []).some((a) => ["recovery", "invite", "otp", "magiclink"].includes(a.method) && Date.now() / 1000 - a.timestamp < 1800);
  } catch {
    return false;
  }
}

