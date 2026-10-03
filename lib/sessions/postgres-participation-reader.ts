import { FundHold, Participation, type UUID } from "@/domain";
import { fromDatabaseCents } from "@/lib/money/cents";
import type { SqlRow } from "@/lib/money/sql";
import {
  choice, date, optionalDate, optionalInteger, optionalText,
  SessionPersistenceError, text,
} from "./postgres-row-values";

/** Shared database mapping; the caller supplies the participant's verified wallet. */
export function hydrateParticipation(row: SqlRow, walletId: UUID): Participation {
  const hold =
    row.hold_id === null
      ? undefined
      : new FundHold({
          holdId: text(row.hold_id),
          participationId: text(row.hold_participation_id),
          holdingAccountId: text(row.holding_account_id),
          walletId: text(row.wallet_id),
          payoutId: optionalText(row.payout_id),
          amount: fromDatabaseCents(row.amount_cents, "amount_cents"),
          state: choice(row.hold_state, [
            "HELD",
            "AWAITING_REPLACEMENT",
            "FORFEITURE_DUE",
            "RELEASED",
            "REFUNDED",
            "FORFEITED",
          ]),
          createdAt: date(row.hold_created_at),
          settledAt: optionalDate(row.settled_at),
        });
  if (hold !== undefined && hold.walletId !== walletId)
    throw new SessionPersistenceError(
      "Participation hold belongs to another wallet",
    );
  return new Participation({
    participationId: text(row.participation_id),
    userId: text(row.user_id),
    status: choice(row.status, [
      "WAITLISTED",
      "COMMITTED",
      "LEFT_WAITLIST",
      "WITHDRAWN",
      "REMOVED",
      "CANCELLED",
    ]),
    attendance: choice(row.attendance, ["UNVERIFIED", "ATTENDED", "ABSENT"]),
    waitlistedAt: optionalDate(row.waitlisted_at),
    committedAt: optionalDate(row.committed_at),
    withdrawnAt: optionalDate(row.withdrawn_at),
    replacementMode:
      row.replacement_mode === null
        ? undefined
        : choice(row.replacement_mode, ["OPEN_SLOT", "DIRECT_INVITE"]),
    replacementInviteeId: optionalText(row.replacement_invitee_id),
    verifiedAt: optionalDate(row.verified_at),
    verificationMethod:
      row.verification_method === null
        ? undefined
        : choice(row.verification_method, ["BOOKER", "AUTOMATIC"]),
    replacesParticipationId: optionalText(row.replaces_participation_id),
    queueSequence: optionalInteger(row.queue_sequence),
    hold,
  });
}
