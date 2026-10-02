import type { Metadata } from "next";
import { PageUnavailableView } from "@/app/_components/page-unavailable-view";

export const metadata: Metadata = { title: "Wallet | Booking Web Manager" };

export default function WalletPage() {
  return <PageUnavailableView kind="development" feature="Wallet" />;
}
