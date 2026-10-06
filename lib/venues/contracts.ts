/** Application-owned fields; browser code never receives OneMap tokens or raw payloads. */
export interface VenueCandidate {
  readonly venueName: string;
  readonly address: string;
  readonly postalCode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly region: "Central" | "East" | "North" | "North-East" | "West" | null;
}

export interface VenueSearchPage {
  readonly items: readonly VenueCandidate[];
  readonly nextPage: number | null;
}

export class VenueSearchUnavailableError extends Error {}
export class VenueSearchProviderError extends Error {}
