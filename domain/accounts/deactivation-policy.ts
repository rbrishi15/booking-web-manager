import { DomainError } from "../shared/errors";
import type { DeactivationInput } from "../shared/operations";

/** Checks authoritative obligation facts without constructing or changing a User. */
export function assertDeactivationAllowed(input: DeactivationInput): void {
  for (const amount of [input.availableBalance, input.heldBalance])
    DomainError.require(
      amount.toCents() >= 0,
      "INVALID_INPUT",
      "Balances cannot be negative",
    );
  for (const count of [
    input.activeCommitments,
    input.unsettledOwnedSessions,
    input.pendingPayouts,
    input.activeOwnedGroups,
  ])
    DomainError.require(
      Number.isSafeInteger(count) && count >= 0,
      "INVALID_INPUT",
      "Obligation counts must be nonnegative safe integers",
    );
  const hasNoOutstandingObligations =
    input.availableBalance.toCents() === 0 &&
    input.heldBalance.toCents() === 0 &&
    input.activeCommitments === 0 &&
    input.unsettledOwnedSessions === 0 &&
    input.pendingPayouts === 0 &&
    input.activeOwnedGroups === 0;
  DomainError.require(
    hasNoOutstandingObligations,
    "ACTIVE_OBLIGATIONS",
    "Outstanding obligations prevent deactivation",
  );
}
