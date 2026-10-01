import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { DiscoveryController } from "./_components/discovery-controller";
import { loadDiscoveryScreen, type PageSearchParams } from "./load-screen";
import { discoveryReturnTo } from "./navigation";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage({ searchParams }: {
  readonly searchParams: Promise<PageSearchParams>;
}) {
  const user = await getCurrentUser();
  if (user === null) redirect("/login?next=%2Fdiscover");
  const params = await searchParams;
  const screen = await loadDiscoveryScreen(user.id, params);
  const returnTo = discoveryReturnTo(params.returnTo);
  return <DiscoveryController key={screen.queryKey} {...screen} pathname="/discover" presentation="search" returnTo={returnTo} />;
}
