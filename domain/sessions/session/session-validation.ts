import { DomainError } from "../../shared/errors";
import type {
  PayoutDestination,
  SettlementBatch,
} from "../../shared/operations";
import type { UUID } from "../../shared/types";
import type { FundHold } from "../fund-hold";
import type { SessionDetails } from "./session";
import type { ParticipantListView } from "./participant-list";
import { validateNextQueueSequence } from "./participant-list-validation";

export function validateSessionDetails(details: SessionDetails): void {
  requireId(details.sessionId, "sessionId");
  requireId(details.bookerId, "bookerId");
  requireId(details.holdingAccountId, "holdingAccountId");
  DomainError.require(
    details.roomToken.trim() !== "",
    "INVALID_INPUT",
    "A session needs a room token",
  );
  DomainError.require(
    Array.isArray(details.participations),
    "INVALID_INPUT",
    "A session needs a participation roster",
  );
  const participations = details.participations;
  if (details.invitedGroupId !== undefined)
    requireId(details.invitedGroupId, "invitedGroupId");
  if (details.pendingSettlement !== undefined)
    validateSettlementBatch(details.pendingSettlement);
  if (details.payoutAttemptIds !== undefined)
    DomainError.require(
      Array.isArray(details.payoutAttemptIds) &&
        new Set(details.payoutAttemptIds).size ===
          details.payoutAttemptIds.length,
      "DUPLICATE_ID",
      "Payout attempt IDs must be unique",
    );
  if (details.payoutIdempotencyKeys !== undefined)
    DomainError.require(
      Array.isArray(details.payoutIdempotencyKeys) &&
        new Set(details.payoutIdempotencyKeys).size ===
          details.payoutIdempotencyKeys.length,
      "DUPLICATE_ID",
      "Payout idempotency keys must be unique",
    );
  validateNextQueueSequence(participations, details.nextQueueSequence);
}

type SessionConfiguration = Pick<
  SessionDetails,
  "status" | "visibility" | "totalSlots" | "minimumHeadcount"
>;

export function validateSessionConfiguration(
  input: SessionConfiguration,
): void {
  DomainError.require(
    [
      "OPEN",
      "CANCELLED",
      "AWAITING_PAYOUT",
      "PAYOUT_PENDING",
      "SETTLED",
    ].includes(input.status),
    "INVALID_INPUT",
    "Unknown session status",
  );
  DomainError.require(
    input.visibility === "PRIVATE" || input.visibility === "PUBLIC",
    "INVALID_INPUT",
    "Unknown session visibility",
  );
  const hasValidSlotCount =
    Number.isSafeInteger(input.totalSlots) &&
    input.totalSlots > 0 &&
    input.totalSlots <= 8;
  DomainError.require(
    hasValidSlotCount,
    "INVALID_INPUT",
    "totalSlots must be a safe integer from 1 to 8",
  );
  const hasValidMinimumHeadcount =
    Number.isSafeInteger(input.minimumHeadcount) &&
    input.minimumHeadcount >= 2 &&
    input.minimumHeadcount <= input.totalSlots;
  DomainError.require(
    hasValidMinimumHeadcount,
    "INVALID_INPUT",
    "minimumHeadcount must be between 2 and totalSlots",
  );
}

type SessionStateValidation = Pick<
  SessionDetails,
  "status" | "pendingSettlement" | "sessionId"
> & {
  readonly participantList: ParticipantListView;
  readonly payoutAttemptIds: ReadonlySet<UUID>;
  readonly payoutIdempotencyKeys: ReadonlySet<string>;
};

/** Checks lifecycle and payout state after the participant list is validated. */
export function validateSessionState(input: SessionStateValidation): void {
  if (input.status === "PAYOUT_PENDING")
    DomainError.require(
      input.pendingSettlement !== undefined,
      "INVALID_INPUT",
      "A pending payout needs a settlement batch",
    );
  if (input.status !== "PAYOUT_PENDING")
    DomainError.require(
      input.pendingSettlement === undefined,
      "INVALID_INPUT",
      "Only a payout-pending session may have a settlement batch",
    );
  for (const id of input.payoutAttemptIds)
    DomainError.require(
      id.trim() !== "",
      "INVALID_INPUT",
      "Payout attempt IDs are required",
    );
  for (const key of input.payoutIdempotencyKeys)
    DomainError.require(
      key.trim() !== "",
      "INVALID_INPUT",
      "Payout idempotency keys are required",
    );
  if (input.pendingSettlement !== undefined) {
    validateSettlementBatch(input.pendingSettlement);
    DomainError.require(
      input.pendingSettlement.sessionId === input.sessionId,
      "INVALID_INPUT",
      "Settlement batch belongs to another session",
    );
    DomainError.require(
      input.payoutAttemptIds.has(input.pendingSettlement.payoutId),
      "INVALID_INPUT",
      "Pending payout ID was not recorded",
    );
    DomainError.require(
      input.payoutIdempotencyKeys.has(input.pendingSettlement.idempotencyKey),
      "INVALID_INPUT",
      "Pending payout key was not recorded",
    );
    const holdById = new Map(
      input.participantList.participations
        .map((participation) => participation.hold)
        .filter((hold): hold is FundHold => hold !== undefined)
        .map((hold) => [hold.holdId, hold]),
    );
    const lineIds = new Set<string>();
    for (const line of input.pendingSettlement.lines) {
      DomainError.require(
        !lineIds.has(line.holdId),
        "DUPLICATE_ID",
        "Settlement lines cannot repeat a hold",
      );
      lineIds.add(line.holdId);
      const hold = holdById.get(line.holdId);
      DomainError.require(
        hold !== undefined,
        "INVALID_INPUT",
        "Settlement line references an unknown hold",
      );
      const lineMatchesHold =
        hold.participationId === line.participationId &&
        hold.amount.equals(line.amount) &&
        hold.holdingAccountId === line.holdingAccountId &&
        hold.walletId === line.walletId;
      DomainError.require(
        lineMatchesHold,
        "INVALID_INPUT",
        "Settlement line does not match its hold",
      );
      DomainError.require(
        hold.state === "HELD" || hold.state === "FORFEITURE_DUE",
        "INVALID_INPUT",
        "A pending settlement line must reference an unsettled hold",
      );
      const hasValidReleaseOutcome =
        line.kind === "RELEASE"
          ? hold.state === "HELD" &&
            input.participantList.requireParticipation(line.participationId)
              .attendance === "ATTENDED"
          : true;
      DomainError.require(
        hasValidReleaseOutcome,
        "INVALID_INPUT",
        "A release line must reference attended funds",
      );
      const participation = input.participantList.requireParticipation(
        line.participationId,
      );
      const isPayableParticipation =
        participation !== undefined &&
        (participation.status === "COMMITTED" ||
          participation.status === "WITHDRAWN");
      DomainError.require(
        isPayableParticipation,
        "INVALID_INPUT",
        "A settlement line must reference a payable participation",
      );
      const hasValidForfeitOutcome =
        line.kind === "FORFEIT"
          ? participation.status === "WITHDRAWN" ||
            participation.attendance === "ABSENT" ||
            hold.state === "FORFEITURE_DUE"
          : true;
      DomainError.require(
        hasValidForfeitOutcome,
        "INVALID_INPUT",
        "A forfeit line has an invalid outcome",
      );
    }
  }
  if (input.status === "SETTLED" || input.status === "CANCELLED")
    DomainError.require(
      input.participantList.participations.every(
        (participation) =>
          participation.hold === undefined ||
          ["REFUNDED", "RELEASED", "FORFEITED"].includes(
            participation.hold.state,
          ),
      ),
      "INVALID_INPUT",
      "A closed session cannot retain active funds",
    );
  if (input.status === "CANCELLED")
    DomainError.require(
      input.participantList.participations.every(
        (participation) => participation.status === "CANCELLED",
      ),
      "INVALID_INPUT",
      "A cancelled session must cancel its participations",
    );
}

export function validDate(value: Date, name: string): Date {
  if (!Number.isFinite(value.getTime()))
    throw new DomainError("INVALID_INPUT", `${name} must be a valid Date`);
  return new Date(value.getTime());
}

export function requireId(value: string, name: string): void {
  DomainError.require(
    value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}

export function cloneBatch(batch: SettlementBatch): SettlementBatch {
  return {
    ...batch,
    requestedAt: validDate(batch.requestedAt, "requestedAt"),
    destination: { ...batch.destination },
    lines: batch.lines.map((line) => ({ ...line })),
  };
}

export function validatePayoutDestination(
  destination: PayoutDestination,
): void {
  requireId(destination.payoutAccountId, "payoutAccountId");
  requireId(destination.userId, "userId");
  DomainError.require(
    destination.providerAccountReference.trim() !== "",
    "INVALID_INPUT",
    "providerAccountReference is required",
  );
  DomainError.require(
    destination.bankAccountReference.trim() !== "",
    "INVALID_INPUT",
    "bankAccountReference is required",
  );
}

export function validateSettlementBatch(batch: SettlementBatch): void {
  requireId(batch.payoutId, "payoutId");
  requireId(batch.sessionId, "sessionId");
  DomainError.require(
    batch.idempotencyKey.trim() !== "",
    "INVALID_INPUT",
    "idempotencyKey is required",
  );
  validDate(batch.requestedAt, "requestedAt");
  validatePayoutDestination(batch.destination);
  DomainError.require(
    Array.isArray(batch.lines) && batch.lines.length > 0,
    "INVALID_INPUT",
    "A settlement batch needs at least one line",
  );
  const lineIds = new Set<string>();
  for (const line of batch.lines) {
    requireId(line.holdId, "holdId");
    requireId(line.participationId, "participationId");
    requireId(line.holdingAccountId, "holdingAccountId");
    requireId(line.walletId, "walletId");
    DomainError.require(
      line.amount.toCents() > 0,
      "INVALID_INPUT",
      "Settlement amounts must be positive Money values",
    );
    DomainError.require(
      line.kind === "RELEASE" || line.kind === "FORFEIT",
      "INVALID_INPUT",
      "Unknown settlement line kind",
    );
    DomainError.require(
      !lineIds.has(line.holdId),
      "DUPLICATE_ID",
      "Settlement lines cannot repeat a hold",
    );
    lineIds.add(line.holdId);
  }
}
