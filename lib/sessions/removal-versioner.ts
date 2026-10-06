import type { Session, UUID } from "@/domain";
import { fingerprintOf } from "@/lib/money/idempotency";
import type { RemovalVersioner } from "@/use-cases/sessions/session-removal-transaction";

/** Only ownership, lifecycle and the selected participant can invalidate this preview. */
export class ParticipantRemovalVersioner implements RemovalVersioner {
  of(session: Session, participationId: UUID): string {
    const p = session.participantList.requireParticipation(participationId);
    return fingerprintOf({
      sessionId: session.sessionId, bookerId: session.bookerId, status: session.status,
      startAt: session.booking.startAt.toISOString(), holdingAccountId: session.holdingAccountId,
      participation: {
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
      },
    });
  }
}
