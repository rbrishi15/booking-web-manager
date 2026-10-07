import { commitmentAction } from "@/app/commit/commitment-action";
import { parseWithdrawInput } from "@/app/commit/withdrawal-input";

export const runtime = "nodejs";

/** UC2-05: withdraw; the domain applies the 30-hour refund rule. */
export const POST = commitmentAction({
  parse: parseWithdrawInput,
  run: (dependencies, input) => dependencies.withdrawFromSession.forParticipant(input),
  invalidRequestMessage: "Invalid withdrawal request",
});
