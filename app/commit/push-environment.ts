import { z } from "zod";

export interface PushSettings {
  /** Contact URI the push service may use: `mailto:` or `https:`. */
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

const settingsSchema = z.object({
  VAPID_SUBJECT: z.string().trim().regex(/^(mailto:|https:\/\/)\S+$/),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().trim().regex(/^[A-Za-z0-9_-]{80,}$/),
  VAPID_PRIVATE_KEY: z.string().trim().regex(/^[A-Za-z0-9_-]{40,}$/),
});

/**
 * Web Push VAPID settings, or undefined when any is missing or malformed.
 * Without them, commitment notifications are accepted but not delivered.
 * Generate a key pair with `npx web-push generate-vapid-keys`.
 */
export function readPushSettings(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PushSettings | undefined {
  const parsed = settingsSchema.safeParse(environment);
  if (!parsed.success) return undefined;
  return {
    subject: parsed.data.VAPID_SUBJECT,
    publicKey: parsed.data.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey: parsed.data.VAPID_PRIVATE_KEY,
  };
}
