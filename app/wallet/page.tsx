"use client";

import { WalletView } from "./_components/wallet-view";
import { walletTransport } from "./wallet-transport";
import { useWalletScreen } from "./wallet-queries";

/**
 * UC1-05: the signed-in user's wallet. The page is the controller: it connects the wallet API
 * (through React Query) to the display-only WalletView. Middleware and the layout require a login.
 */
export default function WalletPage() {
  return <WalletView {...useWalletScreen(walletTransport)} />;
}
