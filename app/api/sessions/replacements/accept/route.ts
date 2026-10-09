import { commitmentAction } from "@/app/commit/commitment-action";
import { parseSessionActionInput } from "@/app/commit/withdrawal-input";

export const runtime = "nodejs";

/** UC2-05: accept a named replacement invitation, refunding the withdrawer. */
export const POST = commitmentAction({
  parse: parseSessionActionInput,
  run: (dependencies, input) => dependencies.acceptReplacement.forInvitee(input),
  invalidRequestMessage: "Invalid replacement acceptance request",
  successStatus: 201,
});
