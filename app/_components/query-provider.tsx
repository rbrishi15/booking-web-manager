"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/** Creates one React Query client per browser tab (never shared between users on the server). */
export function QueryProvider({ children }: { readonly children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    // Screens show their own Retry action, so a failed read is reported at once rather than retried silently.
    defaultOptions: { queries: { retry: false } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
