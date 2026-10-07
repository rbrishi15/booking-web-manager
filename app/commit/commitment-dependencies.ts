import type { AcceptReplacement } from "@/use-cases/sessions/AcceptReplacement";
import type { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import type { LeaveWaitlist } from "@/use-cases/sessions/LeaveWaitlist";
import type { VerifyAttendance } from "@/use-cases/sessions/VerifyAttendance";
import type { WithdrawFromSession } from "@/use-cases/sessions/WithdrawFromSession";
import type { Authenticate } from "./http";

/** App-owned capabilities for the UC2-04/05/06 commitment action routes. */
export interface CommitmentDependencies {
  readonly authenticate: Authenticate;
  readonly commitToSession: Pick<CommitToSession, "forParticipant">;
  readonly withdrawFromSession: Pick<WithdrawFromSession, "forParticipant">;
  readonly acceptReplacement: Pick<AcceptReplacement, "forInvitee">;
  readonly leaveWaitlist: Pick<LeaveWaitlist, "forParticipant">;
  readonly verifyAttendance: Pick<VerifyAttendance, "forBooker">;
}
