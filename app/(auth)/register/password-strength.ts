export type StrengthLabel = "weak" | "fair" | "good" | "strong";

export interface PasswordStrength {
  /** 0–4: how many of the four bars to fill. */
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly label: StrengthLabel;
}

const LABELS: readonly StrengthLabel[] = ["weak", "weak", "fair", "good", "strong"];

/**
 * A rough, display-only hint for the register form's strength bar (mockup 02).
 * It never blocks sign-up; the real rule is registerSchema's 8-character minimum.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < 8) return { score: password.length === 0 ? 0 : 1, label: "weak" };

  const checks = [
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const passed = checks.filter(Boolean).length;
  const score = Math.min(4, 1 + passed) as PasswordStrength["score"];

  return { score, label: LABELS[score] ?? "weak" };
}