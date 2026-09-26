import type { User } from "../accounts/user";
import type { Money } from "../finance/money";
import type { ReliabilityScore } from "../reliability/reliability-score";
import { DomainError } from "../shared/errors";
import type {
  AdmissionResult,
  FinancialInstruction,
  PromotionResult,
} from "../shared/operations";
import type { Visibility } from "../shared/statuses";
import type { UUID } from "../shared/types";
import { FundHold } from "./fund-hold";
import { Participation } from "./participation";
import type { JoinCommand, PromotionCommand } from "./session";
import {
  availableSlots,
  lockInstruction,
  nextWaitlisted,
  oldestAwaiting,
  refundInstruction,
  replaceParticipation,
} from "./session-roster";
import { requireId, validDate } from "./session-validation";

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

function assertAccess(
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
    "The user does not have access to this private session",
  );
}

function assertEligible(
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

function ineligibilityReason(
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

interface JoinRules extends AccessRules, EligibilityRules {
  readonly sessionId: UUID;
  readonly holdingAccountId: UUID;
  readonly nextQueueSequence: number;
}

interface AdmissionChange<Result> {
  readonly participations: Participation[];
  readonly nextQueueSequence: number;
  readonly result: Result;
}

export function calculateJoin(
  rules: JoinRules,
  user: User,
  command: JoinCommand,
): AdmissionChange<AdmissionResult> {
  assertAccess(rules, user, command.roomToken, command.replacementToken);
  assertEligible(rules, user, false);
  const existing = rules.participations.find((p) => p.userId === user.userId);
  if (existing !== undefined && existing.status !== "LEFT_WAITLIST") {
    throw new DomainError(
      existing.status === "WITHDRAWN" || existing.status === "REMOVED"
        ? "REJOIN_NOT_ALLOWED"
        : "ALREADY_PARTICIPATING",
      "This user already has a participation",
    );
  }
  if (
    existing !== undefined &&
    command.participationId !== existing.participationId
  ) {
    throw new DomainError(
      "DUPLICATE_ID",
      "Waitlist re-entry must reuse the existing participation ID",
    );
  }

  validDate(command.now, "now");
  if (
    availableSlots(rules.participations, rules.totalSlots) === 0 ||
    nextWaitlisted(rules.participations) !== undefined
  ) {
    const sequence = rules.nextQueueSequence;
    DomainError.require(
      Number.isSafeInteger(sequence) &&
        sequence > 0 &&
        sequence < Number.MAX_SAFE_INTEGER,
      "INVALID_INPUT",
      "Queue sequence overflowed",
    );
    const queued = Participation.createWaitlisted({
      participationId: existing?.participationId ?? command.participationId,
      userId: user.userId,
      waitlistedAt: command.now,
      queueSequence: sequence,
    });
    return {
      participations:
        existing === undefined
          ? [...rules.participations, queued]
          : replaceParticipation(
              rules.participations,
              existing.participationId,
              queued,
            ),
      nextQueueSequence: sequence + 1,
      result: {
        kind: "WAITLISTED",
        participationId: queued.participationId,
        instructions: [],
      },
    };
  }
  assertEligible(rules, user, true);
  const holdId = command.holdId;
  DomainError.require(
    holdId !== undefined,
    "INVALID_INPUT",
    "A commitment needs a hold ID",
  );
  const hold = createAdmissionHold(
    rules,
    command.participationId,
    holdId,
    user,
    command.now,
  );
  const replacement = oldestAwaiting(rules.participations);
  const committed = Participation.createCommitted({
    participationId: existing?.participationId ?? command.participationId,
    userId: user.userId,
    committedAt: command.now,
    hold,
    replacementMode: command.replacementMode,
    replacesParticipationId: replacement?.participationId,
  });
  const next =
    existing === undefined
      ? [...rules.participations, committed]
      : replaceParticipation(
          rules.participations,
          existing.participationId,
          committed,
        );
  const refund = refundOldestAwaiting(rules.sessionId, next, command.now);
  return {
    participations: refund.participations,
    nextQueueSequence: rules.nextQueueSequence,
    result: {
      kind: "COMMITTED",
      participationId: committed.participationId,
      refundedParticipationId: refund.participationId,
      instructions: [
        lockInstruction(rules.sessionId, committed, command.now),
        ...(refund.instruction === undefined ? [] : [refund.instruction]),
      ],
    },
  };
}

function createAdmissionHold(
  rules: {
    readonly holdingAccountId: UUID;
    readonly totalCost: Money;
    readonly totalSlots: number;
  },
  participationId: UUID,
  holdId: UUID,
  user: User,
  now: Date,
): FundHold {
  return FundHold.create({
    holdId,
    participationId,
    holdingAccountId: rules.holdingAccountId,
    walletId: user.wallet.walletId,
    amount: rules.totalCost.divideFloor(rules.totalSlots),
    createdAt: now,
  });
}

function refundOldestAwaiting(
  sessionId: UUID,
  participations: readonly Participation[],
  at: Date,
): {
  readonly participations: Participation[];
  readonly participationId?: UUID;
  readonly instruction?: FinancialInstruction;
} {
  const awaiting = oldestAwaiting(participations);
  if (awaiting === undefined || awaiting.hold === undefined)
    return { participations: [...participations] };
  const refunded = awaiting.refundReplacement(at);
  return {
    participations: replaceParticipation(
      participations,
      awaiting.participationId,
      refunded,
    ),
    participationId: awaiting.participationId,
    instruction: refundInstruction(sessionId, refunded, at),
  };
}

interface PromotionRules extends EligibilityRules {
  readonly sessionId: UUID;
  readonly holdingAccountId: UUID;
  readonly participations: readonly Participation[];
  readonly nextQueueSequence: number;
}

export function calculatePromotion(
  rules: PromotionRules,
  user: User,
  command: PromotionCommand,
): AdmissionChange<PromotionResult> {
  const next = nextWaitlisted(rules.participations);
  if (next === undefined)
    return {
      participations: [...rules.participations],
      nextQueueSequence: rules.nextQueueSequence,
      result: { kind: "NONE", instructions: [] },
    };
  requireId(command.holdId, "holdId");
  validDate(command.now, "now");
  DomainError.require(
    availableSlots(rules.participations, rules.totalSlots) > 0,
    "CAPACITY_EXCEEDED",
    "There is no available slot to promote",
  );
  DomainError.require(
    next.userId === user.userId,
    "INVALID_INPUT",
    "Promotion input belongs to another user",
  );
  const reason = ineligibilityReason(rules, user);
  if (reason !== undefined) {
    return {
      participations: replaceParticipation(
        rules.participations,
        next.participationId,
        next.leaveWaitlist(),
      ),
      nextQueueSequence: rules.nextQueueSequence,
      result: {
        kind: "SKIPPED",
        participationId: next.participationId,
        reason,
        instructions: [],
      },
    };
  }
  const replacement = oldestAwaiting(rules.participations);
  const committed = next.commit(
    createAdmissionHold(
      rules,
      next.participationId,
      command.holdId,
      user,
      command.now,
    ),
    command.now,
    replacement?.participationId,
  );
  const participations = replaceParticipation(
    rules.participations,
    next.participationId,
    committed,
  );
  const refund = refundOldestAwaiting(
    rules.sessionId,
    participations,
    command.now,
  );
  return {
    participations: refund.participations,
    nextQueueSequence: rules.nextQueueSequence,
    result: {
      kind: "PROMOTED",
      participationId: committed.participationId,
      refundedParticipationId: refund.participationId,
      instructions: [
        lockInstruction(rules.sessionId, committed, command.now),
        ...(refund.instruction === undefined ? [] : [refund.instruction]),
      ],
    },
  };
}
