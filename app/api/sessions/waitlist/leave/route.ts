import { commitmentAction } from "@/app/commit/commitment-action";
import { parseSessionActionInput } from "@/app/commit/withdrawal-input";

export const runtime = "nodejs";

/** UC2-05: leave the joining waitlist. */
export const POST = commitmentAction({
  parse: parseSessionActionInput,
  run: (dependencies, input) => dependencies.leaveWaitlist.forParticipant(input),
  invalidRequestMessage: "Invalid waitlist departure request",
});
