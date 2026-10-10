import type { User } from "@supabase/supabase-js";
import { bookingAccountIneligibility, DomainError, type UUID } from "@/domain";
import type { AccountStatus } from "./account-status";

/**
 * The account checks every authentication policy applies after it has verified who the user
 * is: an active profile and, when required, an email address. Returns the user ID.
 */
export function requireAccountAccess(
  user: User,
  status: AccountStatus,
  options: { readonly requireEmail?: boolean } = {},
): UUID {
  switch (status.kind) {
    case "inactive":
      throw new DomainError(
        "INACTIVE_ACCOUNT",
        "An inactive account cannot use the session API",
      );
    case "missing-profile":
      throw new DomainError("NOT_FOUND", "User was not found");
    case "lookup-failed":
      throw new Error("Account status could not be checked", {
        cause: status,
      });
    case "active": {
      if (options.requireEmail) {
        const reason = bookingAccountIneligibility({
          accountStatus: "ACTIVE",
          hasEmail: Boolean(user.email?.trim()),
        });
        if (reason !== undefined) throw new DomainError(reason, "Add an email address to create or join sessions");
      }
      return user.id;
    }
  }
}
