import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";

export default function CreateSessionLayout({ children }: { readonly children: React.ReactNode }) {
  return <SignedInShell mobileVariant="focused">{children}</SignedInShell>;
}
