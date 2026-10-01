"use client";

import { DiscoveryRouteFallback } from "./_components/discovery-route-fallback";

/** Includes failures before authentication or discovery props could be obtained. */
export default function DiscoveryError({ reset }: { readonly reset: () => void }) {
  return <DiscoveryRouteFallback retry={reset} />;
}
