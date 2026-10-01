import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";

/** Signed-in frame for /profile, the Settings page (UC1-03, UC1-04). */
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <SignedInShell>{children}</SignedInShell>;
}