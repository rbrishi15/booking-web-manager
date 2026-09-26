import { Booking, Money } from "@/domain";
import { describe, expect, test } from "vitest";

const details = {
  venueName: "Court",
  region: "North",
  sport: "Badminton",
  totalCost: Money.fromCents(100),
  startAt: new Date("2026-10-01"),
  endAt: new Date("2026-10-02"),
};

describe("Booking", () => {
  test("constructor_WhenCostIsZero_ThrowsRangeError", () => {
    // Arrange
    const invalidDetails = { ...details, totalCost: Money.fromCents(0) };

    // Act & Assert
    expect(() => new Booking(invalidDetails)).toThrow(RangeError);
  });

  test("constructor_WhenVenueIsBlank_ThrowsRangeError", () => {
    // Arrange
    const invalidDetails = { ...details, venueName: " " };

    // Act & Assert
    expect(() => new Booking(invalidDetails)).toThrow(RangeError);
  });

  test("constructor_WhenStartEqualsEnd_ThrowsRangeError", () => {
    // Arrange
    const invalidDetails = { ...details, startAt: details.endAt };

    // Act & Assert
    expect(() => new Booking(invalidDetails)).toThrow(RangeError);
  });

  test("constructor_WhenEndDateIsInvalid_ThrowsRangeError", () => {
    // Arrange
    const invalidDetails = { ...details, endAt: new Date(Number.NaN) };

    // Act & Assert
    expect(() => new Booking(invalidDetails)).toThrow(RangeError);
  });

  test("constructor_WhenSourceAndExposedDatesAreMutated_PreservesTimes", () => {
    // Arrange
    const source = { ...details, startAt: new Date(details.startAt) };
    const booking = new Booking(source);

    // Act
    source.startAt.setFullYear(2000);
    booking.startAt.setFullYear(2001);
    booking.endAt.setFullYear(2002);

    // Assert
    expect(booking.startAt).toEqual(details.startAt);
    expect(booking.endAt).toEqual(details.endAt);
  });

  test("equals_WhenValuesMatch_ReturnsTrue", () => {
    // Arrange
    const booking = new Booking(details);
    const other = new Booking(details);

    // Act
    const equalBookings = booking.equals(other);

    // Assert
    expect(equalBookings).toBe(true);
  });

  test("equals_WhenVenueDiffers_ReturnsFalse", () => {
    // Arrange
    const booking = new Booking(details);
    const other = new Booking({ ...details, venueName: "Other" });

    // Act
    const equalBookings = booking.equals(other);

    // Assert
    expect(equalBookings).toBe(false);
  });

  test("hasStarted_WhenTimeEqualsStart_ReturnsTrue", () => {
    // Arrange
    const booking = new Booking(details);

    // Act
    const hasStarted = booking.hasStarted(details.startAt);

    // Assert
    expect(hasStarted).toBe(true);
  });

  test("hasEnded_WhenTimeEqualsEnd_ReturnsTrue", () => {
    // Arrange
    const booking = new Booking(details);

    // Act
    const hasEnded = booking.hasEnded(details.endAt);

    // Assert
    expect(hasEnded).toBe(true);
  });
});
