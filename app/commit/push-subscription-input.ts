import { z } from "zod";
import { invalidRequest } from "@/app/http/request-failure";
import type { WebPushSubscription } from "@/lib/commit/web-push-notifier";

const endpoint = z
  .string()
  .max(2048)
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Push endpoints use HTTPS");
const key = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(256);

/** `PushSubscription.toJSON()` from the browser; extra fields are ignored. */
export const pushSubscriptionSchema = z.object({
  endpoint,
  keys: z.object({ p256dh: key, auth: key }),
});
export const pushUnsubscribeSchema = z.object({ endpoint });

export function parsePushSubscription(body: unknown): WebPushSubscription {
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) throw invalidRequest("Invalid push subscription");
  return parsed.data;
}

export function parsePushEndpoint(body: unknown): string {
  const parsed = pushUnsubscribeSchema.safeParse(body);
  if (!parsed.success) throw invalidRequest("Invalid push subscription");
  return parsed.data.endpoint;
}
