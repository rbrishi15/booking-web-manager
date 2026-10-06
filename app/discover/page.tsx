import { DiscoveryController } from "./_components/discovery-controller";
import { loadDiscoveryScreen, type PageSearchParams } from "./load-screen";
import { discoveryReturnTo } from "./navigation";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage({ searchParams }: {
  readonly searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  const screen = await loadDiscoveryScreen(params);
  const returnTo = discoveryReturnTo(params.returnTo);
  return <DiscoveryController key={screen.queryKey} {...screen} returnTo={returnTo} />;
}
