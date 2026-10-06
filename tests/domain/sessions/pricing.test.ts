import { describe, expect, test } from "vitest";
import { sessionPricing, resolveBookingShare } from "@/domain/sessions/pricing";
import { Money } from "@/domain";

describe("Session pricing", () => {
  test.each([
    [1001, 3, 333, 167, 666], [6000, 8, 750, 375, 1500], [2, 2, 1, 1, 2],
    [Number.MAX_SAFE_INTEGER, 2, 4503599627370495, 2251799813685248, 4503599627370495],
    [Number.MAX_SAFE_INTEGER, 8, 1125899906842623, 562949953421312, 1125899906842623],
  ])("sessionPricing_WhenCostIs%sAndSlots%s_ReturnsExactBounds", (cost, slots, suggestedCents, minimumCents, maximumCents) => {
    // Arrange & Act
    const pricing = sessionPricing(cost, slots);
    // Assert
    expect(pricing).toEqual({ suggestedCents, minimumCents, maximumCents });
    expect(BigInt(maximumCents) * BigInt(slots)).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
  });
  test.each([0, 1, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("sessionPricing_WhenCostIs%s_RejectsUnsafeOrZeroShare", (cost) => {
    // Arrange & Act & Assert
    expect(() => sessionPricing(cost, 2)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
  test.each([0, 1, 9, 2.5, NaN])("sessionPricing_WhenSlotsAre%s_RejectsInvalidCapacity", (slots) => {
    // Arrange & Act & Assert
    expect(() => sessionPricing(1000, slots)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
  test("resolveBookingShare_WhenPriceIsOmitted_PreservesEqualSplit", () => {
    // Arrange
    const cost = Money.fromCents(1001);
    // Act
    const share = resolveBookingShare(cost, 3);
    // Assert
    expect(share.toCents()).toBe(333);
  });
  test.each([167, 334, 666])("resolveBookingShare_WhenPriceIs%s_AcceptsBoundedAdjustment", (price) => {
    // Arrange
    const cost = Money.fromCents(1001);
    // Act
    const share = resolveBookingShare(cost, 3, Money.fromCents(price));
    // Assert
    expect(share.toCents()).toBe(price);
  });
  test.each([0, 166, 667])("resolveBookingShare_WhenPriceIs%s_RejectsOutsideBounds", (price) => {
    // Arrange & Act & Assert
    expect(() => resolveBookingShare(Money.fromCents(1001), 3, Money.fromCents(price))).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
