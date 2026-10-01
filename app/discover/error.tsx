"use client";

import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { DiscoveryHero } from "./_components/discovery-hero";

/** Also covers failures before the page can obtain its authenticated server outcome. */
export default function DiscoveryError({ reset }: { readonly reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-6 md:px-8 md:pb-12 md:pt-0 xl:px-12">
      <DiscoveryHero />
      <div className="space-y-6 md:space-y-3">
        <h1 className="text-2xl font-bold tracking-tight md:hidden">Discover sessions</h1>
        <h2 className="hidden text-2xl font-bold tracking-tight md:block">Discover sessions</h2>
        <ErrorMessage>We couldn&apos;t load sessions. Please try again.</ErrorMessage>
        <Button variant="outline" className="h-11 md:h-10" onClick={reset}>Retry</Button>
      </div>
    </div>
  );
}
