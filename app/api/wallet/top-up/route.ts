import { walletAction } from "@/app/wallet/wallet-action";
import { parseTopUpInput } from "@/app/wallet/top-up-input";

export const runtime = "nodejs";

/** UC1-05: initiate a PayNow top-up intent for the authenticated user's wallet. */
export const POST = walletAction({
  parse: parseTopUpInput,
  run: (dependencies, input) =>
    dependencies.createTopUpIntent(input.userId, input.body),
  invalidRequestMessage: "Invalid top-up request",
  successStatus: 201,
});
