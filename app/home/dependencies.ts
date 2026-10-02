import type { ListUpcomingBookings } from "@/use-cases/sessions/ListUpcomingBookings";
import type { WeatherState } from "./types";

export interface HomeDependencies {
  readonly upcomingBookings: Pick<ListUpcomingBookings, "list">;
  readonly weather: () => Promise<WeatherState>;
}

export class HomeUnavailableError extends Error {
  constructor() { super("Upcoming bookings are unavailable"); }
}
