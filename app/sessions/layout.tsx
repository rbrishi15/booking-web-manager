import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";

export default function SessionsLayout({ children }: { readonly children: React.ReactNode }) {
  return <SignedInShell>{children}</SignedInShell>;
}
