import type { Metadata } from "next";
import { WalletController } from "./_components/wallet-controller";

export const metadata: Metadata = { title: "Wallet | Booking Web Manager" };

/** UC1-05: the signed-in user's wallet. Middleware and the wallet layout require a login. */
export default function WalletPage() {
  return <WalletController />;
}
