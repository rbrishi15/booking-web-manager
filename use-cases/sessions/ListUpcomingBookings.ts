import type { Region, Sport, UUID } from "@/domain";
import type { Clock } from "../shared/contracts";

/** A personal booking summary without room tokens, roster, or payment details. */
export interface UpcomingBooking {
  readonly sessionId: UUID;
  readonly venueName: string;
  readonly sport: Sport;
  readonly region: Region;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface UpcomingBookingsQuery {
  readonly userId: UUID;
  readonly now: Date;
  readonly limit: number;
}

/** Reads owned or COMMITTED sessions that are OPEN and strictly upcoming.
 * Private sessions are included only through ownership or participation.
 * Results are unique and ordered by start time, then session ID.
 */
export interface UpcomingBookingsReader {
  list(query: UpcomingBookingsQuery): Promise<readonly UpcomingBooking[]>;
}

export const UPCOMING_BOOKINGS_LIMIT = 20;

/** The caller supplies the verified active account, never a client-chosen ID. */
export class ListUpcomingBookings {
  constructor(
    private readonly dependencies: {
      readonly reader: UpcomingBookingsReader;
      readonly clock: Clock;
    },
  ) {}

  async list(userId: UUID): Promise<readonly UpcomingBooking[]> {
    return this.dependencies.reader.list({
      userId,
      now: this.dependencies.clock.now(),
      limit: UPCOMING_BOOKINGS_LIMIT,
    });
  }
}
