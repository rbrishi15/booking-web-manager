import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";

/** Discovery is a signed-in screen; the page and middleware enforce account access. */
export default function DiscoveryLayout({ children }: { readonly children: React.ReactNode }) {
  return <SignedInShell mobileVariant="focused">{children}</SignedInShell>;
}
