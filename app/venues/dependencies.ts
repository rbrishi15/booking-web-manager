import type { VenueSearchPage } from "@/lib/venues/contracts";

export interface VenueApiDependencies {
  readonly authenticate: (request: Request) => Promise<string | null>;
  readonly search: (query: string, page: number) => Promise<VenueSearchPage>;
}
