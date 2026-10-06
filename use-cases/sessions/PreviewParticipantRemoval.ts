import { DomainError, type UUID } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import { participantRemovalRefundCents, requireParticipantListOwner } from "./participant-removal-preview";
import type { RemovalVersioner, SessionRemovalReadTransaction } from "./session-removal-transaction";

export interface ParticipantRemovalPreview {
  readonly sessionId: UUID;
  readonly participationId: UUID;
  readonly refundCents: number;
  readonly previewVersion: string;
}

/** UC2-03b: run domain removal on the read aggregate without persisting it. */
export class PreviewParticipantRemoval {
  constructor(private readonly dependencies: {
    readonly transaction: SessionRemovalReadTransaction;
    readonly clock: Clock;
    readonly versioner: RemovalVersioner;
  }) {}

  async forBooker(bookerId: UUID, sessionId: UUID, participationId: UUID): Promise<ParticipantRemovalPreview> {
    return this.dependencies.transaction.run(async ({ users, sessions }) => {
      const user = await requireAggregate(users, bookerId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      const session = await requireAggregate(sessions, sessionId, "Session");
      requireParticipantListOwner(user, session);
      const previewVersion = this.dependencies.versioner.of(session, participationId);
      const result = user.asBooker().removeParticipant(session, participationId, this.dependencies.clock.now());
      return { sessionId, participationId, refundCents: participantRemovalRefundCents(result), previewVersion };
    });
  }
}
