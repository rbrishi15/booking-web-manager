import { timingSafeEqual } from "node:crypto";

/**
 * Accepts only `Authorization: Bearer <cronSecret>`, compared in constant
 * time. An unset or blank secret authorizes nothing, so a missing
 * configuration can never open the scheduler endpoint.
 */
export function isAuthorizedCronRequest(request: Request, cronSecret: string): boolean {
  if (cronSecret.trim() === "") return false;
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
