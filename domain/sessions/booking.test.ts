import { describe, expect, it } from "vitest";
import { Money } from "../finance/money";
import { Booking } from "./booking";
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
    const booking = Booking.create(details);
    expect(booking.equals(Booking.reconstitute(booking.snapshot()))).toBe(true);
    expect(
      booking.equals(Booking.create({ ...details, venueName: "Other" })),
    ).toBe(false);
    expect(booking.hasStarted(details.startAt)).toBe(true);
    expect(booking.hasEnded(details.endAt)).toBe(true);
  });
  it("rejects invalid costs, venue and dates", () => {
    for (const patch of [
      { totalCost: Money.fromCents(0) },
      { venueName: " " },
      { startAt: details.endAt },
      { endAt: new Date(Number.NaN) },
    ])
      expect(() => Booking.create({ ...details, ...patch })).toThrow();
  });
  it("does not expose mutable dates", () => {
    const source = { ...details, startAt: new Date(details.startAt) };
    const booking = Booking.create(source);
    source.startAt.setFullYear(2000);
    booking.startAt.setFullYear(2001);
    booking.snapshot().endAt.setFullYear(2002);
    expect(booking.startAt).toEqual(details.startAt);
    expect(booking.endAt).toEqual(details.endAt);
  });
});
