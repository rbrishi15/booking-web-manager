import type { Session } from "@/domain";
import { fingerprintOf } from "@/lib/money/idempotency";
import type { CancellationVersioner } from "@/use-cases/sessions/session-cancellation-transaction";

/** Hashes authoritative cancellation state, excluding visibility and operation time. */
export class SessionCancellationVersioner implements CancellationVersioner {
  of(session: Session): string {
    return fingerprintOf({
      sessionId: session.sessionId, bookerId: session.bookerId, status: session.status,
      startAt: session.booking.startAt.toISOString(), holdingAccountId: session.holdingAccountId,
      nextQueueSequence: session.participantList.nextQueueSequence,
      participations: session.participantList.participations.map((p) => ({
        participationId: p.participationId, userId: p.userId, status: p.status,
        attendance: p.attendance, verificationMethod: p.verificationMethod, verifiedAt: p.verifiedAt?.toISOString(),
        waitlistedAt: p.waitlistedAt?.toISOString(), committedAt: p.committedAt?.toISOString(),
        withdrawnAt: p.withdrawnAt?.toISOString(), queueSequence: p.queueSequence,
        replacementMode: p.replacementMode, replacementInviteeId: p.replacementInviteeId,
        replacesParticipationId: p.replacesParticipationId,
        hold: p.hold && {
          holdId: p.hold.holdId, participationId: p.hold.participationId, walletId: p.hold.walletId,
          holdingAccountId: p.hold.holdingAccountId, amountCents: p.hold.amount.toCents(),
          state: p.hold.state, createdAt: p.hold.createdAt.toISOString(),
          settledAt: p.hold.settledAt?.toISOString(), payoutId: p.hold.payoutId,
        },
      })),
    });
  }
}
