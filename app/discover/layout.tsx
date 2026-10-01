import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";

export default function DiscoveryLayout({ children }: { readonly children: React.ReactNode }) {
  return <SignedInShell>{children}</SignedInShell>;
}
