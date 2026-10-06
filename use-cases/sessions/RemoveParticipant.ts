import { DomainError, type UUID } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import { ParticipantRemovalConflict, participantRemovalRefundCents, requireParticipantListOwner } from "./participant-removal-preview";
import type { RemovalVersioner, SessionParticipantRemovalResult, SessionRemovalTransaction } from "./session-removal-transaction";

/** UC2-03b: domain removal, its full refund and durable replay are one transaction. */
export class RemoveParticipant {
  constructor(private readonly dependencies: {
    readonly transaction: SessionRemovalTransaction;
    readonly clock: Clock;
    readonly versioner: RemovalVersioner;
  }) {}

  async forBooker(bookerId: UUID, sessionId: UUID, participationId: UUID, previewVersion: string): Promise<SessionParticipantRemovalResult> {
    return this.dependencies.transaction.run(async ({ users, sessions, ledger, submission }) => {
      const user = await requireAggregate(users, bookerId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      return submission.once(bookerId, sessionId, participationId, previewVersion, async () => {
        const session = await requireAggregate(sessions, sessionId, "Session");
        requireParticipantListOwner(user, session);
        const currentVersion = this.dependencies.versioner.of(session, participationId);
        // Capture server time after the session lock, including on whole-transaction retries.
        const result = user.asBooker().removeParticipant(session, participationId, this.dependencies.clock.now());
        if (previewVersion !== currentVersion) throw new ParticipantRemovalConflict();
        await ledger.append(result.instructions);
        await sessions.saveRemoval(session, participationId);
        return { sessionId, participationId, status: "REMOVED", refundCents: participantRemovalRefundCents(result) };
      });
    });
  }
}
