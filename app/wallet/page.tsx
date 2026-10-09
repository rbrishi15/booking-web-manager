import type { Metadata } from "next";
import { WalletView } from "./_components/wallet-view";

export const metadata: Metadata = { title: "Wallet | Booking Web Manager" };

/** UC1-05: the signed-in user's wallet. Middleware and the wallet layout require a login. */
export default function WalletPage() {
  return <WalletView />;
}
