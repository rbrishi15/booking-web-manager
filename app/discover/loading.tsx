import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { DiscoveryHero } from "./_components/discovery-hero";

export default function DiscoveryLoading() {
  return <div className="mx-auto w-full max-w-[1440px] px-6 py-6 md:px-8 md:pb-12 md:pt-0 xl:px-12">
    <DiscoveryHero />
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight md:hidden">Discover sessions</h1>
      <h2 className="hidden text-2xl font-bold tracking-tight md:block">Discover sessions</h2>
      <LoadingSpinner label="Loading sessions…" />
    </div>
  </div>;
}
