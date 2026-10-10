import type { AccountStatus } from "../shared/statuses";

/** Account facts required before creating or joining a booking room. */
export interface BookingAccountEligibility {
  readonly accountStatus: AccountStatus;
  readonly hasEmail: boolean;
}

/** The same account policy applies to roles, authentication and action offers. */
export function bookingAccountIneligibility(
  account: BookingAccountEligibility,
): "INACTIVE_ACCOUNT" | "EMAIL_REQUIRED" | undefined {
  if (account.accountStatus !== "ACTIVE") return "INACTIVE_ACCOUNT";
  if (!account.hasEmail) return "EMAIL_REQUIRED";
  return undefined;
}
