import type { Session, User, UUID, WithdrawalPreview } from "@/domain";
import type { Clock, Repository } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";

/** Complete aggregates for a read-only calculation; nothing is saved. */
export interface WithdrawalPreviewRepositories {
  readonly users: Pick<Repository<User>, "get">;
  readonly sessions: { get(sessionId: UUID): Promise<Session | null> };
}

export interface WithdrawalPreviewTransaction {
  run<T>(
    work: (repositories: WithdrawalPreviewRepositories) => Promise<T>,
  ): Promise<T>;
}

export interface WithdrawalPreviewResult {
  readonly sessionId: UUID;
  readonly participationId: UUID;
  /** REFUNDED: refunded at once. AWAITING_REPLACEMENT: the share stays held. */
  readonly kind: WithdrawalPreview["kind"];
  /** Returned to the wallet if the participant withdraws now. */
  readonly refundCents: number;
  /** The share currently held for this participation. */
  readonly heldCents: number;
}

/**
 * UC2-05: shows what withdrawing now would do before the participant commits
 * to it (CLAUDE.md: "the applicable refund amount is shown before any
 * irreversible action").
 *
 * Calls `Participant.previewWithdrawal`, which applies the same authorization,
 * lifecycle checks and 30-hour rule as the withdrawal itself, so the refund
 * shown matches the refund given at the same moment. Nothing is saved and no
 * money moves. The participation is the caller's own, found by their user ID.
 */
export class PreviewWithdrawal {
  constructor(
    private readonly dependencies: {
      readonly transaction: WithdrawalPreviewTransaction;
      readonly clock: Clock;
    },
  ) {}

  async forParticipant(
    userId: UUID,
    sessionId: UUID,
  ): Promise<WithdrawalPreviewResult> {
    const { transaction, clock } = this.dependencies;
    return transaction.run(async ({ users, sessions }) => {
      const user = await requireAggregate(users, userId, "User");
      const session = await requireAggregate(sessions, sessionId, "Session");
      const preview = user
        .asParticipant()
        .previewWithdrawal(session, clock.now());
      return {
        sessionId,
        participationId: preview.participationId,
        kind: preview.kind,
        refundCents: preview.refundAmount.toCents(),
        heldCents: preview.heldAmount.toCents(),
      };
    });
  }
}
