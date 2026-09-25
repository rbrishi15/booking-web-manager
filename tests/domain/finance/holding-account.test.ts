import { DomainError, HoldingAccount } from "@/domain";
import { describe, expect, test } from "vitest";

describe("HoldingAccount", () => {
  test("constructor_WhenIdentityIsValid_PreservesAccountId", () => {
    // Arrange
    const details = { accountId: "platform" };

    // Act
    const account = new HoldingAccount(details);

    // Assert
    expect(account.accountId).toBe("platform");
  });

  test("constructor_WhenAccountIdIsBlank_ThrowsDomainError", () => {
    // Arrange
    const details = { accountId: " " };

    // Act & Assert
    expect(() => new HoldingAccount(details)).toThrow(DomainError);
  });
});
