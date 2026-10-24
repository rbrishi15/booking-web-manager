import { pathWithNext } from "@/app/(auth)/redirect-path";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { redirect } from "next/navigation";
import { DiscoveryController } from "./_components/discovery-controller";
import { loadDiscoveryScreen, type PageSearchParams } from "./load-screen";
import { discoveryReturnTo } from "./navigation";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage({ searchParams }: {
  readonly searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  // Middleware isn't the only boundary: block server rendering before querying sessions.
  const viewer = await getCurrentUser();
  if (viewer?.accountStatus !== "ACTIVE") {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach((item) => query.append(name, item));
      else if (value !== undefined) query.append(name, value);
    }
    redirect(pathWithNext("/login", `/discover${query.size ? `?${query}` : ""}`));
  }
  const screen = await loadDiscoveryScreen(params);
  const returnTo = discoveryReturnTo(params.returnTo);
  return <DiscoveryController key={screen.queryKey} {...screen} returnTo={returnTo} />;
}
