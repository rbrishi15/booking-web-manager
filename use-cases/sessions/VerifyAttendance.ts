import type { AttendanceMark, SessionStatus, UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";

export interface VerifyAttendanceRequest {
  /** The authenticated user; the domain checks they are the session's booker. */
  readonly userId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
  readonly marks: readonly AttendanceMark[];
}

export interface VerifyAttendanceResult {
  readonly sessionId: UUID;
  /** AWAITING_PAYOUT once every committed participant has been verified. */
  readonly status: SessionStatus;
}

/**
 * UC2-06 Verify Attendance, by the booker after the session ends.
 *
 * In one unit of work, runs `Booker.verifyAttendance`, which authorizes the
 * booker and records each mark. Once every committed participant is verified
 * the session becomes AWAITING_PAYOUT: attended and absent shares are then
 * payable to the booker as RELEASE and FORFEIT lines of the session's payout.
 * No money moves here; the payout flow writes those ledger lines when the
 * provider confirms the payout.
 */
export class VerifyAttendance {
  constructor(
    private readonly dependencies: Pick<
      UseCaseDependencies,
      "unitOfWork" | "clock"
    >,
  ) {}

  async forBooker(
    request: VerifyAttendanceRequest,
  ): Promise<VerifyAttendanceResult> {
    const { unitOfWork, clock } = this.dependencies;
    const key = JSON.stringify([
      "UC2-06-verify",
      request.userId,
      request.sessionId,
      request.idempotencyKey,
    ]);

    return unitOfWork.execute(key, async (transaction) => {
      const user = await requireAggregate(
        transaction.users,
        request.userId,
        "User",
      );
      const session = await requireAggregate(
        transaction.sessions,
        request.sessionId,
        "Session",
      );

      user.asBooker().verifyAttendance(session, {
        marks: request.marks,
        now: clock.now(),
      });

      await transaction.sessions.save(session);
      return { sessionId: session.sessionId, status: session.status };
    });
  }
}
