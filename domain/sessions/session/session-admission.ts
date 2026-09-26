import type {
  Participant,
  ParticipantJoinCommand,
} from "../../accounts/participant";
import type { Money } from "../../finance/money";
import type { ReliabilityScore } from "../../reliability/reliability-score";
import { DomainError } from "../../shared/errors";
import type {
  AdmissionResult,
  FinancialInstruction,
  PromotionResult,
} from "../../shared/operations";
import type { Visibility } from "../../shared/statuses";
import type { UUID } from "../../shared/types";
import { Participation } from "../participation";
import {
  lockInstruction,
  refundInstruction,
} from "../participation-instructions";
import type { PromotionCommand } from "./session";
import {
  availableSlots,
  nextWaitlisted,
  oldestAwaiting,
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
  participant: Participant,
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
    participant.isMemberOf(rules.invitedGroupId)
  )
    return;
  throw new DomainError(
    "INVALID_ACCESS",
    "The user does not have access to this private session",
  );
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
  participant: Participant,
  command: ParticipantJoinCommand,
): AdmissionChange<AdmissionResult> {
  assertAccess(rules, participant, command.roomToken, command.replacementToken);
  const terms = {
    minimumReliability: rules.minimumReliability,
    share: rules.totalCost.divideFloor(rules.totalSlots),
  };
  participant.assertEligibleFor(terms, false);
  const existing = rules.participations.find(
    (p) => p.userId === participant.userId,
  );
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
      userId: participant.userId,
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
  participant.assertEligibleFor(terms, true);
  const holdId = command.holdId;
  DomainError.require(
    holdId !== undefined,
    "INVALID_INPUT",
    "A commitment needs a hold ID",
  );
  const hold = participant.createAdmissionHold({
    participationId: command.participationId,
    holdId,
    holdingAccountId: rules.holdingAccountId,
    share: terms.share,
    now: command.now,
  });
  const replacement = oldestAwaiting(rules.participations);
  const committed = Participation.createCommitted({
    participationId: existing?.participationId ?? command.participationId,
    userId: participant.userId,
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
  participant: Participant,
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
    next.userId === participant.userId,
    "INVALID_INPUT",
    "Promotion input belongs to another user",
  );
  const terms = {
    minimumReliability: rules.minimumReliability,
    share: rules.totalCost.divideFloor(rules.totalSlots),
  };
  const reason = participant.admissionIneligibility(terms);
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
    participant.createAdmissionHold({
      participationId: next.participationId,
      holdId: command.holdId,
      holdingAccountId: rules.holdingAccountId,
      share: terms.share,
      now: command.now,
    }),
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
