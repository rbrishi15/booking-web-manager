import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";
import { PageUnavailableView } from "./_components/page-unavailable-view";

/** Unknown URLs retain the signed-in navigation instead of showing Next's bare 404. */
export default async function NotFound() {
  const user = isAuthenticationConfigured() ? await getCurrentUser() : null;
  const content = <PageUnavailableView kind="not-found" signedIn={user !== null} />;
  return user ? <SignedInShell>{content}</SignedInShell> : <main>{content}</main>;
}
