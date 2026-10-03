import { SignedInShell } from "@/app/(auth)/_components/signed-in-shell";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { isAuthenticationConfigured } from "@/lib/supabase/is-configured";
import { BookingLogo } from "@/components/ui/booking-logo";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function DiscoveryLayout({ children }: { readonly children: React.ReactNode }) {
  // Personalization is optional: an Auth outage must not hide public listings.
  const user = isAuthenticationConfigured() ? await getCurrentUser().catch(() => null) : null;
  if (user !== null) return <SignedInShell mobileVariant="focused">{children}</SignedInShell>;
  return <div className="min-h-screen bg-background">
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5 md:px-8">
      <Link href="/" aria-label="Home"><BookingLogo /></Link>
      <Button asChild variant="outline"><Link href="/login?next=%2Fdiscover">Log in</Link></Button>
    </header>
    <main>{children}</main>
  </div>;
}
