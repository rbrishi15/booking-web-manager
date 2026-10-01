import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";
import { LandingView } from "./_components/landing-view";
import { HomeController } from "./home/_components/home-controller";
import { loadHomeScreen } from "./home/load-screen";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isAuthenticationConfigured()) return <LandingView />;
  const user = await getCurrentUser();
  if (user === null) return <LandingView />;
  const outcome = await loadHomeScreen(user.id);
  return <SignedInShell><HomeController outcome={outcome} /></SignedInShell>;
}
