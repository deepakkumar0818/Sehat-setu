// Rules for a new password, shared by the change-password form (instant
// feedback) and the server (the real check). Pure, so tests can load it.
// Length over composition (NIST SP 800-63B): at least 12 characters, at most
// 72 (Supabase Auth hashes with bcrypt, which ignores anything longer), and
// not an obvious or reused password.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;

const COMMON = ["password", "passw0rd", "123456", "qwerty", "abc123", "letmein", "welcome", "admin", "iloveyou", "sehatsetu", "sehat", "clinic", "doctor"];

/** Why this new password isn't allowed, or null if it's fine. */
export function newPasswordProblem(next: string, opts: { current?: string; email?: string } = {}): string | null {
  if (next.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(next).length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (next.trim() !== next) return "Don't start or end the password with a space.";
  if (opts.current !== undefined && next === opts.current) return "The new password must be different from your current one.";
  const lower = next.toLowerCase();
  if (/^(.)\1+$/.test(next) || new Set(next).size < 4) return "That password is too easy to guess. Mix more different characters.";
  const local = opts.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) return "Don't use your email address in your password.";
  if (COMMON.some((w) => lower.replace(/[^a-z0-9]/g, "").includes(w))) return "That password contains a common word or pattern. Choose something less predictable.";
  return null;
}

/** 0–4, for the strength meter only (the rules above decide what's allowed). */
export function passwordStrength(p: string): 0 | 1 | 2 | 3 | 4 {
  if (!p) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  let score = p.length >= 16 ? 2 : p.length >= PASSWORD_MIN ? 1 : 0;
  score += kinds >= 3 ? 2 : kinds === 2 ? 1 : 0;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
