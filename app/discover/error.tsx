"use client";

import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { PageHeader } from "@/components/ui/page-header";

/** Also covers failures before the page can obtain its authenticated server outcome. */
export default function DiscoveryError({ reset }: { readonly reset: () => void }) {
  return (
    <>
      <PageHeader breadcrumb="Home" title="Discover sessions" />
      <div className="space-y-3 p-4 md:p-8">
        <ErrorMessage>We couldn&apos;t load sessions. Please try again.</ErrorMessage>
        <Button variant="outline" onClick={reset}>Retry</Button>
      </div>
    </>
  );
}
