import type { HomeBooking, WeatherState } from "../types";

export const exampleBookings = [
  { sessionId: "home-tennis-1", sport: "Tennis", venueName: "Bukit Timah CC", region: "West", startAt: "2035-06-16T23:00:00.000Z", endAt: "2035-06-17T00:00:00.000Z" },
  { sessionId: "home-tennis-2", sport: "Tennis", venueName: "Bukit Timah CC", region: "West", startAt: "2035-06-17T01:00:00.000Z", endAt: "2035-06-17T02:00:00.000Z" },
] as const satisfies readonly HomeBooking[];

export const exampleWeather = {
  status: "ready", forecast: "Thundery showers", lowCelsius: 25, highCelsius: 32,
  validFrom: "2035-06-16T22:00:00.000Z", validTo: "2035-06-17T22:00:00.000Z", updatedAt: "2035-06-16T21:35:00.000Z",
} satisfies WeatherState;

export const overnightBooking = {
  ...exampleBookings[0], sessionId: "overnight-tennis", startAt: "2035-12-31T15:00:00.000Z", endAt: "2035-12-31T17:00:00.000Z",
} satisfies HomeBooking;

export const longVenueBooking = {
  ...exampleBookings[0], venueName: "Singapore Community Sports and Recreation Centre — Indoor Multi-purpose Tennis Hall, Level 4, Court 12",
} satisfies HomeBooking;
