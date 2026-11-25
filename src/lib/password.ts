/** Password rules for the app (Supabase enforces the length and character classes too). */
export const PASSWORD_MIN = 12;

export function passwordProblems(pw: string, ctx: { email?: string; name?: string } = {}): string[] {
  const out: string[] = [];
  if (pw.length < PASSWORD_MIN) out.push(`at least ${PASSWORD_MIN} characters`);
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) out.push("letters and numbers");
  if (/^(.)\1+$/.test(pw) || /^(?:0123456789|1234567890|abcdefghijkl|qwertyuiop)/i.test(pw)) out.push("not a simple sequence");
  const lower = pw.toLowerCase();
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if ((local && local.length >= 4 && lower.includes(local)) || lower.includes("luxel") || (ctx.name && ctx.name.length >= 4 && lower.includes(ctx.name.toLowerCase().split(" ")[0]))) {
    out.push("not your name, email or the company name");
  }
  return out;
}
