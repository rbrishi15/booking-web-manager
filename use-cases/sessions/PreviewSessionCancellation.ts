import { DomainError, type UUID } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import type { SessionManagementTransaction } from "./session-management-transaction";
import type { CancellationVersioner } from "./session-cancellation-transaction";
import { affectedParticipantCount, cancellationRefundSummary } from "./cancellation-preview";

export interface SessionCancellationPreview {
  readonly sessionId: UUID;
  readonly affectedParticipantCount: number;
  readonly refundRecipientCount: number;
  readonly totalRefundCents: number;
  readonly previewVersion: string;
}

/** UC2-03c: calculate the domain cancellation without saving or moving funds. */
export class PreviewSessionCancellation {
  constructor(private readonly dependencies: {
    readonly transaction: SessionManagementTransaction;
    readonly clock: Clock;
    readonly versioner: CancellationVersioner;
  }) {}

  async forBooker(bookerId: UUID, sessionId: UUID): Promise<SessionCancellationPreview> {
    return this.dependencies.transaction.run(async ({ users, sessions }) => {
      const user = await requireAggregate(users, bookerId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      const session = await requireAggregate(sessions, sessionId, "Session");
      const previewVersion = this.dependencies.versioner.of(session);
      const count = affectedParticipantCount(session);
      const result = user.asBooker().cancel(session, this.dependencies.clock.now());
      return { sessionId, affectedParticipantCount: count, ...cancellationRefundSummary(result), previewVersion };
    });
  }
}
