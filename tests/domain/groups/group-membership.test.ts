import { DomainError, GroupMembership } from "@/domain";
import { describe, expect, test } from "vitest";

describe("GroupMembership", () => {
  test("constructor_WhenDateIsInvalid_ThrowsDomainError", () => {
    // Arrange
    const details = { userId: "owner", joinedAt: new Date("invalid") };

    // Act & Assert
    expect(() => new GroupMembership(details)).toThrow(DomainError);
  });

  test("constructor_WhenUserIdIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = { userId: " ", joinedAt: now() };

    // Act & Assert
    expect(() => new GroupMembership(details)).toThrow(DomainError);
  });

  test("joinedAt_WhenSourceAndExposedDatesAreMutated_PreservesTimestamp", () => {
    // Arrange
    const joinedAt = now();
    const membership = new GroupMembership({ userId: "owner", joinedAt });

    // Act
    joinedAt.setUTCFullYear(2000);
    membership.joinedAt.setUTCFullYear(2000);

    // Assert
    expect(membership.joinedAt).toEqual(now());
  });
});

function now() {
  return new Date("2026-09-15T00:00:00Z");
}
