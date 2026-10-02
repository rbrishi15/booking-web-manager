import type { DiscoveredSession } from "@/use-cases/sessions/DiscoverSessions";
import { encodeDiscoveryCursor, type DiscoveryCursor } from "./query";

export interface DiscoverySession extends Omit<DiscoveredSession, "startAt" | "endAt"> {
  readonly startAt: string;
  readonly endAt: string;
}

export interface DiscoveryPage {
  readonly items: readonly DiscoverySession[];
  readonly nextCursor: string | null;
}

const DISCOVERY_PAGE_SIZE = 20;

/** Pages summaries ordered by start then ID, exposing only public browser fields. */
export function toDiscoveryPage(sessions: readonly DiscoveredSession[], after?: DiscoveryCursor): DiscoveryPage {
  const first = after === undefined ? 0 : sessions.findIndex((session) =>
    session.startAt.getTime() > after.startAt.getTime() ||
    (session.startAt.getTime() === after.startAt.getTime() && session.sessionId.toLowerCase() > after.sessionId.toLowerCase()),
  );
  const start = first === -1 ? sessions.length : first;
  const items = sessions.slice(start, start + DISCOVERY_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items: items.map((item) => ({
      sessionId: item.sessionId,
      venueName: item.venueName,
      sport: item.sport,
      region: item.region,
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      totalSlots: item.totalSlots,
      bookingShareCents: item.bookingShareCents,
    })),
    nextCursor: start + items.length < sessions.length && last !== undefined
      ? encodeDiscoveryCursor({ startAt: last.startAt, sessionId: last.sessionId })
      : null,
  };
}
