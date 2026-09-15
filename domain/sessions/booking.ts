import { Money } from "../finance/money";
import { copyDate } from "../shared/date";
import type { Region, Sport } from "../shared/types";

export interface BookingSnapshot {
  readonly venueName: string;
  readonly region: Region;
  readonly sport: Sport;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly totalCost: Money;
}
export type BookingCreateProps = BookingSnapshot;
export type BookingProps = BookingSnapshot;

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

  static create(props: BookingSnapshot): Booking {
    const startAt = copyDate(props.startAt, "startAt");
    const endAt = copyDate(props.endAt, "endAt");
    if (endAt <= startAt) {
      throw new RangeError("Booking endAt must be after startAt");
    }
    if (!(props.totalCost instanceof Money)) {
      throw new RangeError("Booking totalCost must be Money");
    }
    if (props.totalCost.toCents() <= 0) {
      throw new RangeError("Booking totalCost must be positive");
    }
    if (
      typeof props.venueName !== "string" ||
      props.venueName.trim() === "" ||
      typeof props.region !== "string" ||
      props.region.trim() === "" ||
      typeof props.sport !== "string" ||
      props.sport.trim() === ""
    ) {
      throw new RangeError("Booking venue, region, and sport are required");
    }
    return new Booking({ ...props, startAt, endAt });
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
