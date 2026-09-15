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

/** Venue details owned by a Session. The actual venue reservation is external. */
export class Booking {
  readonly #venueName: string;
  readonly #region: Region;
  readonly #sport: Sport;
  readonly #startAt: Date;
  readonly #endAt: Date;
  readonly #totalCost: Money;

  constructor(details: BookingDetails) {
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

    this.#venueName = details.venueName;
    this.#region = details.region;
    this.#sport = details.sport;
    this.#startAt = startAt;
    this.#endAt = endAt;
    this.#totalCost = details.totalCost;
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
    return copyDate(at, "at").getTime() >= this.#startAt.getTime();
  }

  hasEnded(at: Date): boolean {
    return copyDate(at, "at").getTime() >= this.#endAt.getTime();
  }

  hoursUntilStart(at: Date): number {
    return (this.#startAt.getTime() - copyDate(at, "at").getTime()) / 3_600_000;
  }

  get venueName(): string {
    return this.#venueName;
  }
  get region(): Region {
    return this.#region;
  }
  get sport(): Sport {
    return this.#sport;
  }
  get startAt(): Date {
    return copyDate(this.#startAt, "startAt");
  }
  get endAt(): Date {
    return copyDate(this.#endAt, "endAt");
  }
  get totalCost(): Money {
    return this.#totalCost;
  }
}
