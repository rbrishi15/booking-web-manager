import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";

/** Signed-in frame for /groups (UC1-06). */
export default function GroupsLayout({ children }: { children: React.ReactNode }) {
  return <SignedInShell>{children}</SignedInShell>;
}