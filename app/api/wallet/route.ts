import { walletGetAction } from "@/app/wallet/wallet-action";

export const runtime = "nodejs";

/** UC1-05: get wallet balance and active holds for the authenticated user. */
export const GET = walletGetAction({
  run: (dependencies, userId) => dependencies.getWalletSummary(userId),
});
