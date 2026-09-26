import type { User } from "../accounts/user";
import type { Money } from "../finance/money";
import type { ReliabilityScore } from "../reliability/reliability-score";
import { DomainError } from "../shared/errors";
import type { Visibility } from "../shared/statuses";
import type { UUID } from "../shared/types";
import type { Participation } from "./participation";

interface AccessRules {
  readonly participations: readonly Participation[];
  readonly visibility: Visibility;
  readonly roomToken: string;
  readonly invitedGroupId?: UUID;
}

interface EligibilityRules {
  readonly minimumReliability?: ReliabilityScore;
  readonly totalCost: Money;
  readonly totalSlots: number;
}

export function meetsReliabilityRequirement(
  score: ReliabilityScore,
  minimum?: ReliabilityScore,
): boolean {
  return minimum === undefined || score.meetsMinimum(minimum);
}

export function assertAccess(
  rules: AccessRules,
  user: User,
  roomToken?: string,
  replacementToken?: string,
): void {
  if (replacementToken !== undefined) {
    DomainError.require(
      rules.participations.some(
        (p) =>
          p.status === "WITHDRAWN" &&
          p.hold?.state === "AWAITING_REPLACEMENT" &&
          p.replacementToken === replacementToken,
      ),
      "INVALID_ACCESS",
      "The replacement link is invalid or no longer available",
    );
    return;
  }
  if (rules.visibility === "PUBLIC") return;
  if (roomToken === rules.roomToken) return;
  if (
    rules.invitedGroupId !== undefined &&
    user.memberGroupIds.includes(rules.invitedGroupId)
  )
    return;
  throw new DomainError(
    "INVALID_ACCESS",
    "The user does not have access to this export function session",
  );
}

export function assertEligible(
  rules: EligibilityRules,
  user: User,
  requireFunds: boolean,
): void {
  const reason = ineligibilityReason(rules, user, requireFunds);
  if (reason === "INACTIVE_ACCOUNT")
    throw new DomainError(
      "INACTIVE_ACCOUNT",
      "An inactive account cannot participate",
    );
  if (reason === "LOW_RELIABILITY")
    throw new DomainError(
      "LOW_RELIABILITY",
      "The user's reliability is below the session requirement",
    );
  if (reason === "INSUFFICIENT_FUNDS")
    throw new DomainError(
      "INSUFFICIENT_FUNDS",
      "The wallet cannot fund this commitment",
    );
}

export function ineligibilityReason(
  rules: EligibilityRules,
  user: User,
  requireFunds = true,
): "INACTIVE_ACCOUNT" | "LOW_RELIABILITY" | "INSUFFICIENT_FUNDS" | undefined {
  if (user.accountStatus !== "ACTIVE") return "INACTIVE_ACCOUNT";
  const score = user.reliabilityScore;
  if (!meetsReliabilityRequirement(score, rules.minimumReliability))
    return "LOW_RELIABILITY";
  if (
    requireFunds &&
    user.wallet
      .getFunds()
      .compareTo(rules.totalCost.divideFloor(rules.totalSlots)) < 0
  )
    return "INSUFFICIENT_FUNDS";
  return undefined;
}
