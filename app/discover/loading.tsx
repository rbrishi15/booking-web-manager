import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageHeader } from "@/components/ui/page-header";

export default function DiscoveryLoading() {
  return <><PageHeader breadcrumb="Home" title="Discover sessions" /><LoadingSpinner label="Loading sessions…" /></>;
}
