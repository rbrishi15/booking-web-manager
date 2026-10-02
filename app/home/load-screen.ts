import { redirect } from "next/navigation";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";
import { HomeUnavailableError } from "./dependencies";
import { getHomeDependencies } from "./server-dependencies";
import type { HomeOutcome } from "./types";

/** Bookings are personal; a failed read must never masquerade as an empty diary. */
export async function loadHomeScreen(userId: string): Promise<HomeOutcome> {
  const account = await getAccountStatus(await createClient(), userId);
  if (account.kind === "inactive" || account.kind === "missing-profile") redirect("/login");
  if (account.kind === "lookup-failed") return { status: "error", kind: "unexpected" };
  try {
    const { upcomingBookings, weather } = await getHomeDependencies();
    const bookings = await upcomingBookings.list(userId);
    if (bookings.length === 0) {
      // Weather has its own failure state and is requested only for an empty diary.
      const forecast = await weather().catch(() => ({ status: "unavailable" as const }));
      return { status: "empty", weather: forecast };
    }
    return {
      status: "ready",
      bookings: bookings.map((booking) => ({
        sessionId: booking.sessionId, venueName: booking.venueName, sport: booking.sport,
        region: booking.region, startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString(),
      })),
    };
  } catch (error) {
    return { status: "error", kind: error instanceof HomeUnavailableError ? "unavailable" : "unexpected" };
  }
}
