import type { Metadata } from "next";
import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";
import { QueryProvider } from "@/app/_components/query-provider";

export const metadata: Metadata = { title: "Wallet | Booking Web Manager" };

export default function WalletLayout({ children }: { readonly children: React.ReactNode }) {
  return <SignedInShell><QueryProvider>{children}</QueryProvider></SignedInShell>;
}
