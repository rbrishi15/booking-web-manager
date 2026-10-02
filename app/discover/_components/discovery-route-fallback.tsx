"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { discoveryReturnTo } from "../navigation";

/** Covers routing before server props arrive, retaining a usable exit from search. */
export function DiscoveryRouteFallback({ retry }: { readonly retry?: () => void }) {
  const params = useSearchParams();
  const origins = params.getAll("returnTo");
  return <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-4 md:px-10 md:py-10">
    <Button asChild variant="outline" size="icon" className="h-11 w-11 rounded-full">
      <Link href={discoveryReturnTo(origins.length === 1 ? origins[0] : undefined)} replace aria-label="Back to previous page"><ArrowLeft aria-hidden /></Link>
    </Button>
    <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-4xl">Find Your<br />Next Game</h1>
    <section aria-label="Upcoming sessions" aria-busy={!retry} className="space-y-4">
      {retry ? <><ErrorMessage>We couldn&apos;t load sessions. Please try again.</ErrorMessage><Button variant="outline" className="h-11" onClick={retry}>Retry</Button></> : <LoadingSpinner label="Loading sessions…" />}
    </section>
  </div>;
}
