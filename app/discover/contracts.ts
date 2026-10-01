import type { DiscoveredSession, DiscoverSessionsResult } from "@/use-cases/sessions/DiscoverSessions";
import { encodeDiscoveryCursor } from "./query";

export interface DiscoverySession extends Omit<DiscoveredSession, "startAt" | "endAt"> {
  readonly startAt: string;
  readonly endAt: string;
}

export interface DiscoveryPage {
  readonly items: readonly DiscoverySession[];
  readonly nextCursor: string | null;
}

/** Explicit allowlist keeps internal fields out of browser props and API JSON. */
export function toDiscoveryPage(result: DiscoverSessionsResult): DiscoveryPage {
  return {
    items: result.items.map((item) => ({
      sessionId: item.sessionId,
      venueName: item.venueName,
      sport: item.sport,
      region: item.region,
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      totalSlots: item.totalSlots,
      bookingShareCents: item.bookingShareCents,
    })),
    nextCursor: result.nextCursor === null ? null : encodeDiscoveryCursor(result.nextCursor),
  };
}
