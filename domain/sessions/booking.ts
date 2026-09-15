import { Money } from "../finance/money";
import { copyDate } from "../shared/date";
import type { Region, Sport } from "../shared/types";

/** Value used when a session is opened. */
export interface BookingDetails {
  readonly venueName: string;
  readonly region: Region;
  readonly sport: Sport;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly totalCost: Money;
}

/** Persistence representation of the immutable booking value. */
export interface BookingSnapshot extends BookingDetails {}

/** Venue details owned by a Session. The actual venue reservation is external. */
export class Booking {
  readonly #snapshot: BookingSnapshot;

  private constructor(snapshot: BookingSnapshot) {
    this.#snapshot = Object.freeze({
      ...snapshot,
      startAt: copyDate(snapshot.startAt, "startAt"),
      endAt: copyDate(snapshot.endAt, "endAt"),
    });
  }

  static create(details: BookingDetails): Booking {
    const startAt = copyDate(details.startAt, "startAt");
    const endAt = copyDate(details.endAt, "endAt");
    if (endAt <= startAt) {
      throw new RangeError("Booking endAt must be after startAt");
    }
    if (!(details.totalCost instanceof Money)) {
      throw new RangeError("Booking totalCost must be Money");
    }
    if (details.totalCost.toCents() <= 0) {
      throw new RangeError("Booking totalCost must be positive");
    }
    if (
      typeof details.venueName !== "string" ||
      details.venueName.trim() === "" ||
      typeof details.region !== "string" ||
      details.region.trim() === "" ||
      typeof details.sport !== "string" ||
      details.sport.trim() === ""
    ) {
      throw new RangeError("Booking venue, region, and sport are required");
    }
    return new Booking({ ...details, startAt, endAt });
  }

  static reconstitute(snapshot: BookingSnapshot): Booking {
    return Booking.create(snapshot);
  }

  snapshot(): BookingSnapshot {
    return {
      ...this.#snapshot,
      startAt: copyDate(this.#snapshot.startAt, "startAt"),
      endAt: copyDate(this.#snapshot.endAt, "endAt"),
    };
  }

  equals(other: Booking): boolean {
    return (
      this.venueName === other.venueName &&
      this.region === other.region &&
      this.sport === other.sport &&
      this.startAt.getTime() === other.startAt.getTime() &&
      this.endAt.getTime() === other.endAt.getTime() &&
      this.totalCost.equals(other.totalCost)
    );
  }

  hasStarted(at: Date): boolean {
    return copyDate(at, "at").getTime() >= this.#snapshot.startAt.getTime();
  }

  hasEnded(at: Date): boolean {
    return copyDate(at, "at").getTime() >= this.#snapshot.endAt.getTime();
  }

  hoursUntilStart(at: Date): number {
    return (
      (this.#snapshot.startAt.getTime() - copyDate(at, "at").getTime()) /
      3_600_000
    );
  }

  get venueName(): string {
    return this.#snapshot.venueName;
  }
  get region(): Region {
    return this.#snapshot.region;
  }
  get sport(): Sport {
    return this.#snapshot.sport;
  }
  get startAt(): Date {
    return copyDate(this.#snapshot.startAt, "startAt");
  }
  get endAt(): Date {
    return copyDate(this.#snapshot.endAt, "endAt");
  }
  get totalCost(): Money {
    return this.#snapshot.totalCost;
  }
}
