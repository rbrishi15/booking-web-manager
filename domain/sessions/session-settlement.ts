import { DomainError } from "../shared/errors";
import type {
  PayoutDestination,
  SettlementBatch,
  SettlementLine,
} from "../shared/operations";
import type { UUID } from "../shared/types";
import type { Participation } from "./participation";
import type { Session } from "./session";
import { expireReplacements } from "./session-roster";
import { validDate } from "./session-validation";

export function prepareSettlementRoster(
  participations: readonly Participation[],
  bookerId: UUID,
  destination: PayoutDestination,
  now: Date,
): Participation[] {
  const next = expireReplacements(participations, now);
  DomainError.require(
    next.every(
      (participation) =>
        participation.status !== "COMMITTED" ||
        participation.attendance !== "UNVERIFIED",
    ),
    "ATTENDANCE_INCOMPLETE",
    "All committed participants must be finalized before settlement",
  );
  DomainError.require(
    destination.userId === bookerId,
    "INVALID_INPUT",
    "Payout destination must belong to the booker",
  );
  return next;
}

export function buildSettlementBatch(
  sessionId: UUID,
  participations: readonly Participation[],
  command: Parameters<Session["prepareSettlement"]>[0],
): SettlementBatch | undefined {
  const lines: SettlementLine[] = [];
  for (const participation of participations) {
    if (
      !(
        participation.status === "COMMITTED" ||
        participation.status === "WITHDRAWN"
      ) ||
      participation.hold === undefined
    )
      continue;
    const hold = participation.hold;
    if (["REFUNDED", "RELEASED", "FORFEITED"].includes(hold.state)) continue;
    DomainError.require(
      hold.state === "HELD" || hold.state === "FORFEITURE_DUE",
      "INVALID_STATE",
      "An unsettled commitment has an invalid hold",
    );
    lines.push({
      holdId: hold.holdId,
      participationId: participation.participationId,
      holdingAccountId: hold.holdingAccountId,
      walletId: hold.walletId,
      amount: hold.amount,
      kind:
        participation.status === "WITHDRAWN" ||
        participation.attendance === "ABSENT" ||
        hold.state === "FORFEITURE_DUE"
          ? "FORFEIT"
          : "RELEASE",
    });
  }
  if (lines.length === 0) return undefined;
  const batch: SettlementBatch = {
    payoutId: command.payoutId,
    sessionId: sessionId,
    idempotencyKey: command.idempotencyKey,
    requestedAt: validDate(command.now, "now"),
    destination: command.destination,
    lines,
  };
  return batch;
}
