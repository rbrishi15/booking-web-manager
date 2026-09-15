import { describe, expect, it } from "vitest";
import { Money } from "../../../domain/finance/money";
import { Booking } from "../../../domain/sessions/booking";
const details = {
  venueName: "Court",
  region: "North",
  sport: "Badminton",
  totalCost: Money.fromCents(100),
  startAt: new Date("2026-10-01"),
  endAt: new Date("2026-10-02"),
};
describe("Booking value object", () => {
  it("compares by all booking values and uses inclusive time queries", () => {
    // Arrange
    const booking = Booking.create(details);
    const restored = Booking.reconstitute(booking.snapshot());
    const otherBooking = Booking.create({ ...details, venueName: "Other" });

    // Act
    const equalsRestored = booking.equals(restored);
    const equalsOther = booking.equals(otherBooking);
    const startsAtStart = booking.hasStarted(details.startAt);
    const endsAtEnd = booking.hasEnded(details.endAt);

    // Assert
    expect(equalsRestored).toBe(true);
    expect(equalsOther).toBe(false);
    expect(startsAtStart).toBe(true);
    expect(endsAtEnd).toBe(true);
  });
  it("rejects invalid costs, venue and dates", () => {
    // Arrange
    const invalidDetails = [
      { totalCost: Money.fromCents(0) },
      { venueName: " " },
      { startAt: details.endAt },
      { endAt: new Date(Number.NaN) },
    ];

    // Act
    const rejected = invalidDetails.map((change) => {
      try {
        Booking.create({ ...details, ...change });
        return false;
      } catch {
        return true;
      }
    });

    // Assert
    expect(rejected).toEqual([true, true, true, true]);
  });
  it("does not expose mutable dates", () => {
    // Arrange
    const source = { ...details, startAt: new Date(details.startAt) };
    const booking = Booking.create(source);

    // Act
    source.startAt.setFullYear(2000);
    booking.startAt.setFullYear(2001);
    booking.snapshot().endAt.setFullYear(2002);

    // Assert
    expect(booking.startAt).toEqual(details.startAt);
    expect(booking.endAt).toEqual(details.endAt);
  });
});
