import type { CommitToSessionHttpDependencies } from "./commit-to-session-handler";
import type { VerifyAttendanceHttpDependencies } from "./verify-attendance-handler";
import type { WithdrawalHttpDependencies } from "./withdrawal-handlers";

/** App-owned capabilities for the UC2-04/05/06 commitment action routes. */
export interface CommitmentDependencies
  extends CommitToSessionHttpDependencies,
    WithdrawalHttpDependencies,
    VerifyAttendanceHttpDependencies {}
