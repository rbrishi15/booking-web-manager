import { DomainError, type UUID, type Visibility } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import type { SessionManagementTransaction } from "./session-management-transaction";

export interface SessionVisibilityResult {
  readonly sessionId: UUID;
  readonly visibility: Visibility;
}

/** UC2-03a: authorize the current account, invoke Booker, and commit visibility. */
export class ToggleSessionVisibility {
  /** Supplies the transaction boundary and clock for visibility authorization and persistence. */
  constructor(private readonly dependencies: {
    readonly transaction: SessionManagementTransaction;
    readonly clock: Clock;
  }) {}

  /** Checks the active owner, lifecycle, and capacity even for unchanged visibility, returning only after the transaction commits. */
  async forBooker(bookerId: UUID, sessionId: UUID, visibility: Visibility): Promise<SessionVisibilityResult> {
    return this.dependencies.transaction.run(async ({ users, sessions }) => {
      const user = await requireAggregate(users, bookerId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
      const session = await requireAggregate(sessions, sessionId, "Session");
      // Capture time after potentially slow aggregate reads. Same-value requests
      // still pass through all ownership, lifecycle, and capacity checks.
      user.asBooker().changeVisibility(session, visibility, this.dependencies.clock.now());
      await sessions.saveVisibility(session);
      return { sessionId: session.sessionId, visibility: session.visibility };
    });
  }
}
