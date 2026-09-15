import { describe, expect, test } from "vitest";
import { PayoutAccount } from "../../../domain/accounts/payout-account";
import { type DeactivationFacts, User } from "../../../domain/accounts/user";
import { Money } from "../../../domain/finance/money";
import { DomainError } from "../../../domain/shared/errors";

const now = () => new Date("2026-09-15T00:00:00Z");
const newUser = () =>
  User.create({ userId: "owner", email: "owner@example.com" });
const clearFacts = (): DeactivationFacts => ({
  availableBalance: Money.fromCents(0),
  heldBalance: Money.fromCents(0),
  activeCommitments: 0,
  unsettledOwnedSessions: 0,
  pendingPayouts: 0,
  activeOwnedGroups: 0,
});

function captureError(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("User aggregate", () => {
  test("creates an active account and changes profile and preferences", () => {
    // Arrange
    const user = newUser();

    // Act
    user.updateProfile({ email: "new@example.com" });
    user.updatePreferences({
      preferredSports: new Set(["Tennis"]),
      preferredRegions: new Set(["West"]),
    });

    // Assert
    expect(user.accountStatus).toBe("ACTIVE");
    expect(user.preferredSports.size).toBe(1);
    expect(user.email).toBe("new@example.com");
    expect([...user.preferredSports]).toEqual(["Tennis"]);
    expect([...user.preferredRegions]).toEqual(["West"]);
  });

  test("copies incoming, outgoing, and reconstituted preference sets", () => {
    // Arrange
    const sports = new Set(["Tennis"]);
    const user = User.create({
      userId: "owner",
      email: "owner@example.com",
      preferredSports: sports,
    });

    // Act
    sports.clear();
    (user.preferredSports as Set<string>).clear();
    const snapshot = user.snapshot();
    const reloaded = User.reconstitute(snapshot);
    (snapshot.preferredSports as Set<string>).clear();

    // Assert
    expect([...user.preferredSports]).toEqual(["Tennis"]);
    expect([...reloaded.preferredSports]).toEqual(["Tennis"]);
  });

  test("rejects invalid profile and preference updates before changing state", () => {
    // Arrange
    const user = newUser();
    const before = user.snapshot();

    // Act
    const invalidProfile = captureError(() =>
      user.updateProfile({ email: " " }),
    );
    const invalidPreferences = captureError(() =>
      user.updatePreferences({
        preferredSports: new Set(["Tennis"]),
        preferredRegions: new Set([" "]),
      }),
    );

    // Assert
    expect(invalidProfile).toEqual(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(invalidPreferences).toEqual(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(user.snapshot()).toEqual(before);
  });

  test("payout setup produces a frozen usable destination only after completion", () => {
    // Arrange
    const user = newUser();

    // Act
    const beforeSetup = captureError(() => user.payoutDestination());
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    const pending = user.payoutAccount;
    user.completePayoutSetup("bank");
    const destination = user.payoutDestination();
    const frozenDestination = user.payoutDestination();
    const failCompletedSetup = () => user.failPayoutSetup();
    const completeWithDifferentBank = () =>
      user.completePayoutSetup("different-bank");

    // Assert
    expect(beforeSetup).toEqual(
      expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
    );
    expect(pending?.setupStatus).toBe("PENDING");
    expect(user.payoutAccount?.setupStatus).toBe("COMPLETE");
    expect(destination).toEqual({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
      bankAccountReference: "bank",
    });
    expect(Object.isFrozen(frozenDestination)).toBe(true);
    expect(failCompletedSetup).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
    expect(completeWithDifferentBank).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  test("failed payout setup can restart but pending setup cannot be overwritten", () => {
    // Arrange
    const user = newUser();

    // Act
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    const overwritePending = () =>
      user.beginPayoutSetup({
        payoutAccountId: "other",
        providerAccountReference: "different",
      });
    user.failPayoutSetup();
    user.beginPayoutSetup({
      payoutAccountId: "replacement",
      providerAccountReference: "provider-2",
    });
    user.completePayoutSetup("bank-2");
    const setupStatus = user.payoutAccount?.setupStatus;
    const destination = user.payoutDestination();

    // Assert
    expect(overwritePending).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
    expect(setupStatus).toBe("COMPLETE");
    expect(destination.payoutAccountId).toBe("replacement");
  });

  test("setup commands require an existing setup and valid bank reference", () => {
    // Arrange
    const user = newUser();

    // Act
    const completeWithoutSetup = captureError(() =>
      user.completePayoutSetup("bank"),
    );
    const failWithoutSetup = captureError(() => user.failPayoutSetup());
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    const completeWithBlankBank = () => user.completePayoutSetup(" ");

    // Assert
    expect(completeWithoutSetup).toEqual(
      expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
    );
    expect(failWithoutSetup).toEqual(
      expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
    );
    expect(completeWithBlankBank).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test.each(["availableBalance", "heldBalance"] as const)(
    "requires zero %s for deactivation",
    (field) => {
      // Arrange
      const user = newUser();
      const before = user.snapshot();

      // Act
      const rejection = captureError(() =>
        user.deactivate({ ...clearFacts(), [field]: Money.fromCents(1) }),
      );

      // Assert
      expect(rejection).toEqual(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(user.snapshot()).toEqual(before);
    },
  );

  test.each([
    "activeCommitments",
    "unsettledOwnedSessions",
    "pendingPayouts",
    "activeOwnedGroups",
  ] as const)("checks %s before deactivation", (field) => {
    // Arrange
    const user = newUser();
    const before = user.snapshot();

    // Act
    const activeObligation = captureError(() =>
      user.deactivate({ ...clearFacts(), [field]: 1 }),
    );
    const negativeValue = captureError(() =>
      user.deactivate({ ...clearFacts(), [field]: -1 }),
    );
    const fractionalValue = captureError(() =>
      user.deactivate({ ...clearFacts(), [field]: 0.5 }),
    );

    // Assert
    expect(activeObligation).toEqual(
      expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
    );
    expect(negativeValue).toEqual(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(fractionalValue).toEqual(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(user.snapshot()).toEqual(before);
  });

  test("deactivation anonymises profile, retains financial identity, and is repeatable", () => {
    // Arrange
    const user = newUser();

    // Act
    user.updatePreferences({
      preferredSports: new Set(["Tennis"]),
      preferredRegions: new Set(["West"]),
    });
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    user.completePayoutSetup("bank");
    user.deactivate(clearFacts());
    user.deactivate(clearFacts());

    const reconstituted = User.reconstitute(user.snapshot());
    const updateInactiveProfile = () =>
      user.updateProfile({ email: "new@example.com" });
    const updateInactivePreferences = () =>
      user.updatePreferences({
        preferredSports: new Set(),
        preferredRegions: new Set(),
      });
    const inactiveDestination = () => user.payoutDestination();

    // Assert
    expect(user.accountStatus).toBe("INACTIVE");
    expect(user.email).toBeNull();
    expect(user.preferredSports.size).toBe(0);
    expect(user.preferredRegions.size).toBe(0);
    expect(user.payoutAccount?.bankAccountReference).toBe("bank");
    expect(reconstituted.snapshot()).toEqual(user.snapshot());
    expect(updateInactiveProfile).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
    expect(updateInactivePreferences).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
    expect(inactiveDestination).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
  });

  test("reconstitution rejects foreign payout accounts and inconsistent account state", () => {
    // Arrange
    const snapshot = newUser().snapshot();
    const payoutAccount = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "other-user",
      providerAccountReference: "provider",
    }).snapshot();
    // Act
    const foreignAccount = () =>
      User.reconstitute({ ...snapshot, payoutAccount });
    const inactiveWithEmail = () =>
      User.reconstitute({ ...snapshot, accountStatus: "INACTIVE" });
    const activeWithoutEmail = () =>
      User.reconstitute({ ...snapshot, email: null });

    // Assert
    expect(foreignAccount).toThrow(DomainError);
    expect(inactiveWithEmail).toThrow(DomainError);
    expect(activeWithoutEmail).toThrow(DomainError);
  });
});
describe("PayoutAccount child entity", () => {
  test("transitions are immutable and completed setup accepts matching duplicate confirmation", () => {
    // Arrange
    const pending = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
    });

    // Act
    const completed = pending.completeSetup("bank");
    const repeatedCompletion = completed.completeSetup("bank");
    const reconstituted = PayoutAccount.reconstitute(completed.snapshot());
    const failPendingThenComplete = () =>
      pending.failSetup().completeSetup("bank");

    // Assert
    expect(pending.setupStatus).toBe("PENDING");
    expect(repeatedCompletion.snapshot()).toEqual(completed.snapshot());
    expect(reconstituted.snapshot()).toEqual(completed.snapshot());
    expect(failPendingThenComplete).toThrow(DomainError);
  });

  test("reconstitution validates bank details against setup status", () => {
    // Arrange
    const snapshot = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
    }).snapshot();
    // Act
    const completeWithoutBank = () =>
      PayoutAccount.reconstitute({ ...snapshot, setupStatus: "COMPLETE" });
    const pendingWithBank = () =>
      PayoutAccount.reconstitute({ ...snapshot, bankAccountReference: "bank" });

    // Assert
    expect(completeWithoutBank).toThrow(DomainError);
    expect(pendingWithBank).toThrow(DomainError);
  });
});
