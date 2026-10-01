/** Public, serializable fields needed by the signed-in Home screen. */
export interface HomeBooking {
  readonly sessionId: string;
  readonly venueName: string;
  readonly sport: string;
  readonly region: string;
  readonly startAt: string;
  readonly endAt: string;
}

/** A national forecast, not a live temperature or venue-specific prediction. */
export type WeatherState =
  | {
      readonly status: "ready";
      readonly forecast: string;
      readonly lowCelsius: number;
      readonly highCelsius: number;
      readonly validFrom: string;
      readonly validTo: string;
      readonly updatedAt: string;
    }
  | { readonly status: "unavailable" };

export type HomeState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly bookings: readonly HomeBooking[] }
  | { readonly status: "empty"; readonly weather: WeatherState }
  | { readonly status: "error"; readonly kind: "unavailable" | "unexpected" };

export type HomeOutcome = Exclude<HomeState, { readonly status: "loading" }>;
