"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { parseDiscoveryQuery } from "../query";
import { discoveryReturnTo } from "../navigation";
import { DiscoverySearchView } from "./discovery-search-view";

// Route loading must use the same responsive composition as the finished page.
// A mobile-only fallback flashes the wrong layout while server props are fetched.
const ignoreWhileLoading = () => undefined;

export function DiscoveryRouteFallback({ retry }: { readonly retry?: () => void }) {
  const params = useSearchParams();
  const origins = params.getAll("returnTo");
  const returnTo = discoveryReturnTo(origins.length === 1 ? origins[0] : undefined);

  if (!retry) {
    return (
      <DiscoverySearchView
        filters={parseDiscoveryQuery(new URLSearchParams(params.toString())).filters}
        state={{ status: "loading" }}
        filterPanel="collapsed"
        loadingSkeleton
        returnTo={returnTo}
        onToggleFilters={ignoreWhileLoading}
        onApply={ignoreWhileLoading}
        onEdit={ignoreWhileLoading}
        onClear={ignoreWhileLoading}
        onNext={ignoreWhileLoading}
        onRetry={ignoreWhileLoading}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 pb-10 pt-4 md:my-5 md:px-10 md:pb-14 md:pt-7">
      <Button asChild variant="outline" size="icon" className="h-11 w-11 rounded-full md:hidden">
        <Link href={returnTo} replace aria-label="Back to previous page"><ArrowLeft aria-hidden="true" /></Link>
      </Button>
      <h1 className="mt-7 text-[28px] font-bold leading-tight tracking-tight md:mt-0 md:text-[38px]">
        <span className="md:hidden">Find Your<br />Next Game</span>
        <span className="hidden md:inline">Upcoming sessions</span>
      </h1>
      <section aria-label="Upcoming sessions" className="mt-6 space-y-4">
        <ErrorMessage>We couldn&apos;t load sessions. Please try again.</ErrorMessage>
        <Button variant="outline" className="h-11" onClick={retry}>Retry</Button>
      </section>
    </div>
  );
}
