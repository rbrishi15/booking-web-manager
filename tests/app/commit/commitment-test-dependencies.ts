import type { CommitmentDependencies } from "@/app/commit/commitment-dependencies";

/** Complete route dependencies; any capability a test does not supply fails if called. */
export function commitmentDependencies(
  overrides: Partial<CommitmentDependencies>,
): CommitmentDependencies {
  const unused = async (): Promise<never> => {
    throw new Error("This dependency is not used by the test");
  };
  return {
    authenticate: unused,
    commitToSession: { forParticipant: unused },
    withdrawFromSession: { forParticipant: unused },
    acceptReplacement: { forInvitee: unused },
    leaveWaitlist: { forParticipant: unused },
    verifyAttendance: { forBooker: unused },
    ...overrides,
  };
}
