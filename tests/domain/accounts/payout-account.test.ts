import { PayoutAccount, type PayoutAccountDetails } from "@/domain";
import { describe, expect, test } from "vitest";

describe("PayoutAccount", () => {
  test("constructor_WhenCompletedWithBankDetails_RestoresCompletedAccount", () => {
    const details = payoutAccountDetails({
      setupStatus: "COMPLETE",
      bankAccountReference: "bank",
    });

    const account = new PayoutAccount(details);

    expect(account.setupStatus).toBe("COMPLETE");
    expect(account.bankAccountReference).toBe("bank");
  });

  test("constructor_WhenCompletedWithoutBankDetails_ThrowsInvalidInput", () => {
    const details = payoutAccountDetails({ setupStatus: "COMPLETE" });

    expect(() => new PayoutAccount(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenPendingWithBankDetails_ThrowsInvalidInput", () => {
    const details = payoutAccountDetails({ bankAccountReference: "bank" });

    expect(() => new PayoutAccount(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("completeSetup_WhenSetupIsPending_ReturnsCompletedCopy", () => {
    const pendingAccount = new PayoutAccount(payoutAccountDetails());

    const completedAccount = pendingAccount.completeSetup("bank");

    expect(completedAccount).not.toBe(pendingAccount);
    expect(pendingAccount.setupStatus).toBe("PENDING");
    expect(pendingAccount.bankAccountReference).toBeUndefined();
    expect(completedAccount.setupStatus).toBe("COMPLETE");
    expect(completedAccount.bankAccountReference).toBe("bank");
  });

  test("completeSetup_WhenConfirmationMatches_ReturnsSameCompletedAccount", () => {
    const pendingAccount = new PayoutAccount(payoutAccountDetails());
    const completedAccount = pendingAccount.completeSetup("bank");

    const repeatedConfirmation = completedAccount.completeSetup("bank");

    expect(repeatedConfirmation).toBe(completedAccount);
  });

  test("completeSetup_WhenRestoredConfirmationMatches_ReturnsSameCompletedAccount", () => {
    const restoredAccount = new PayoutAccount(
      payoutAccountDetails({
        setupStatus: "COMPLETE",
        bankAccountReference: "bank",
      }),
    );

    const repeatedConfirmation = restoredAccount.completeSetup("bank");

    expect(repeatedConfirmation).toBe(restoredAccount);
  });

  test("completeSetup_WhenSetupHasFailed_ThrowsInvalidState", () => {
    const pendingAccount = new PayoutAccount(payoutAccountDetails());
    const failedAccount = pendingAccount.failSetup();

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
