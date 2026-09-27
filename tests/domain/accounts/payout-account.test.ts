import { PayoutAccount, type PayoutAccountDetails } from "@/domain";
import { describe, expect, test } from "vitest";

describe("PayoutAccount", () => {
  test("constructor_WhenCompletedWithBankDetails_RestoresCompletedAccount", () => {
    // Arrange
    const details = payoutAccountDetails({
      setupStatus: "COMPLETE",
      bankAccountReference: "bank",
    });

    // Act
    const account = new PayoutAccount(details);

    // Assert
    expect(account.setupStatus).toBe("COMPLETE");
    expect(account.bankAccountReference).toBe("bank");
  });

  test("constructor_WhenCompletedWithoutBankDetails_ThrowsInvalidInput", () => {
    // Arrange
    const details = payoutAccountDetails({ setupStatus: "COMPLETE" });

    // Act & Assert
    expect(() => new PayoutAccount(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenPendingWithBankDetails_ThrowsInvalidInput", () => {
    // Arrange
    const details = payoutAccountDetails({ bankAccountReference: "bank" });

    // Act & Assert
    expect(() => new PayoutAccount(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("completeSetup_WhenSetupIsPending_ReturnsCompletedCopy", () => {
    // Arrange
    const pendingAccount = new PayoutAccount(payoutAccountDetails());

    // Act
    const completedAccount = pendingAccount.completeSetup("bank");

    // Assert
    expect(completedAccount).not.toBe(pendingAccount);
    expect(pendingAccount.setupStatus).toBe("PENDING");
    expect(pendingAccount.bankAccountReference).toBeUndefined();
    expect(completedAccount.setupStatus).toBe("COMPLETE");
    expect(completedAccount.bankAccountReference).toBe("bank");
  });

  test("completeSetup_WhenConfirmationMatches_ReturnsSameCompletedAccount", () => {
    // Arrange
    const pendingAccount = new PayoutAccount(payoutAccountDetails());
    const completedAccount = pendingAccount.completeSetup("bank");

    // Act
    const repeatedConfirmation = completedAccount.completeSetup("bank");

    // Assert
    expect(repeatedConfirmation).toBe(completedAccount);
  });

  test("completeSetup_WhenRestoredConfirmationMatches_ReturnsSameCompletedAccount", () => {
    // Arrange
    const restoredAccount = new PayoutAccount(
      payoutAccountDetails({
        setupStatus: "COMPLETE",
        bankAccountReference: "bank",
      }),
    );

    // Act
    const repeatedConfirmation = restoredAccount.completeSetup("bank");

    // Assert
    expect(repeatedConfirmation).toBe(restoredAccount);
  });

  test("completeSetup_WhenSetupHasFailed_ThrowsInvalidState", () => {
    // Arrange
    const pendingAccount = new PayoutAccount(payoutAccountDetails());
    const failedAccount = pendingAccount.failSetup();

    // Act & Assert
    expect(() => failedAccount.completeSetup("bank")).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });
});

function payoutAccountDetails(
  overrides: Partial<PayoutAccountDetails> = {},
): PayoutAccountDetails {
  return {
    payoutAccountId: "account",
    userId: "owner",
    providerAccountReference: "provider",
    setupStatus: "PENDING",
    ...overrides,
  };
}
