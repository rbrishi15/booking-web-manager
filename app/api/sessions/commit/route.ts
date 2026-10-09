import { commitmentAction } from "@/app/commit/commitment-action";
import { parseCommitToSessionInput } from "@/app/commit/commit-to-session-input";

export const runtime = "nodejs";

/** UC2-04: commit to a session, locking the share in the same transaction, or join its waitlist. */
export const POST = commitmentAction({
  parse: parseCommitToSessionInput,
  run: (dependencies, input) => dependencies.commitToSession.forParticipant(input),
  invalidRequestMessage: "Invalid commitment request",
  successStatus: 201,
});
