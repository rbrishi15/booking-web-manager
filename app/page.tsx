import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";
import { LandingView } from "./_components/landing-view";
import { DiscoveryController } from "./discover/_components/discovery-controller";
import { loadDiscoveryScreen, type PageSearchParams } from "./discover/load-screen";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { readonly searchParams: Promise<PageSearchParams> }) {
  if (!isAuthenticationConfigured()) return <LandingView />;
  const user = await getCurrentUser();
  if (user === null) return <LandingView />;
  const screen = await loadDiscoveryScreen(user.id, await searchParams);
  return <SignedInShell><DiscoveryController key={screen.queryKey} {...screen} pathname="/" presentation="home" /></SignedInShell>;
}
