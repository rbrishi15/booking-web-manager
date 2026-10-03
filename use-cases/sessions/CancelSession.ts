import { DomainError, type UUID } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import { CancellationConflict, cancellationRefundSummary } from "./cancellation-preview";
import type { CancellationVersioner, SessionCancellationResult, SessionCancellationTransaction } from "./session-cancellation-transaction";

/** UC2-03c: cancellation, refunds and replay response commit together. */
export class CancelSession {
  constructor(private readonly dependencies: {
    readonly transaction: SessionCancellationTransaction;
    readonly clock: Clock;
    readonly versioner: CancellationVersioner;
  }) {}

  async forBooker(bookerId: UUID, sessionId: UUID, previewVersion: string): Promise<SessionCancellationResult> {
    return this.dependencies.transaction.run(async ({ users, sessions, ledger, submission }) => {
      const user = await requireAggregate(users, bookerId, "User");
      // Authorize current access before consulting cached financial responses.
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      return submission.once(bookerId, sessionId, previewVersion, async () => {
        const session = await requireAggregate(sessions, sessionId, "Session");
        const currentVersion = this.dependencies.versioner.of(session);
        const result = user.asBooker().cancel(session, this.dependencies.clock.now());
        if (previewVersion !== currentVersion) throw new CancellationConflict();
        await ledger.append(result.instructions);
        await sessions.saveCancellation(session);
        return { sessionId, status: "CANCELLED", ...cancellationRefundSummary(result) };
      });
    });
  }
}
