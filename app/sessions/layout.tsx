import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";

/** Wraps session pages in the shared signed-in application shell. */
export default function SessionsLayout({ children }: { readonly children: React.ReactNode }) {
  return <SignedInShell>{children}</SignedInShell>;
}
