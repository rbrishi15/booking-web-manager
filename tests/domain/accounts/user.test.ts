import {
  type DeactivationInput,
  Email,
  Money,
  PayoutAccount,
  User,
} from "@/domain";
import { describe, expect, test } from "vitest";
import { createTestUserDetails, userLoadedAt } from "./user-fixtures";

describe("User", () => {
  describe("Construction and registration", () => {
    test("constructor_WhenEmailIsProvided_PreservesTheEmailValue", () => {
      // Arrange
      const email = new Email("Owner+bookings@Example.COM");
      const details = createTestUserDetails({ userId: "owner", email });

      // Act
      const user = new User(details);

      // Assert
      expect(user.email).toBe(email);
      expect(user.email?.toString()).toBe("Owner+bookings@Example.COM");
    });

    test("constructor_WhenActiveAccountHasNoEmail_ThrowsInvalidInput", () => {
      // Arrange
      const details = createTestUserDetails({ userId: "owner", email: null });

      // Act & Assert
      expect(() => new User(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenInactiveAccountHasEmail_ThrowsInvalidInput", () => {
      // Arrange
      const details = createTestUserDetails({
        userId: "owner",
        accountStatus: "INACTIVE",
        email: new Email("owner@example.com"),
      });

      // Act & Assert
      expect(() => new User(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenLoadingDeactivatedUser_RestoresAnonymisedProfile", () => {
      // Arrange
      const original = createActiveUser();
      original.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      original.completePayoutSetup("bank");
      original.deactivate(deactivationWithoutObligations());
      const details = createTestUserDetails({
        userId: "owner",
        accountStatus: "INACTIVE",
        email: null,
        payoutAccount: original.payoutAccount,
      });

      // Act
      const restored = new User(details);

      // Assert
      expect(restored.accountStatus).toBe("INACTIVE");
      expect(restored.email).toBeNull();
      expect(accountStateOf(restored)).toEqual(accountStateOf(original));
    });

    test("constructor_WhenPayoutAccountBelongsToAnotherUser_ThrowsInvalidInput", () => {
      // Arrange
      const payoutAccount = PayoutAccount.create({
        payoutAccountId: "account",
        userId: "other-user",
        providerAccountReference: "provider",
      });
      const details = createTestUserDetails({ userId: "owner", payoutAccount });

      // Act & Assert
      expect(() => new User(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenSourcePreferencesChange_PreservesStoredPreferences", () => {
      // Arrange
      const sports = new Set(["Tennis"]);
      const regions = new Set(["West"]);
      const user = new User(
        createTestUserDetails({
          userId: "owner",
          preferredSports: sports,
          preferredRegions: regions,
        }),
      );

      // Act
      sports.clear();
      regions.clear();

      // Assert
      expect([...user.preferredSports]).toEqual(["Tennis"]);
      expect([...user.preferredRegions]).toEqual(["West"]);
    });

    test("create_WhenRegistrationIsValid_ReturnsAnActiveUser", () => {
      // Arrange
      const email = new Email("owner@example.com");

      // Act
      const user = User.create({
        userId: "owner",
        email,
        walletId: "w-owner",
        now: userLoadedAt,
      });

      // Assert
      expect(user.accountStatus).toBe("ACTIVE");
      expect(user.email).toBe(email);
    });

    test("create_WhenSourcePreferencesChange_PreservesStoredPreferences", () => {
      // Arrange
      const sports = new Set(["Tennis"]);
      const regions = new Set(["West"]);
      const user = User.create({
        userId: "owner",
        email: new Email("owner@example.com"),
        walletId: "w-owner",
        now: userLoadedAt,
        preferredSports: sports,
        preferredRegions: regions,
      });

      // Act
      sports.clear();
      regions.clear();

      // Assert
      expect([...user.preferredSports]).toEqual(["Tennis"]);
      expect([...user.preferredRegions]).toEqual(["West"]);
    });
  });

  describe("Profile and preferences", () => {
    test("updateProfile_WhenAccountIsActive_ReplacesEmail", () => {
      // Arrange
      const user = createActiveUser();
      const email = new Email("new@example.com");

      // Act
      user.updateProfile({ email });

      // Assert
      expect(user.email).toBe(email);
      expect(user.email?.toString()).toBe("new@example.com");
    });

    test("updateProfile_WhenAccountIsInactive_RejectsWithoutChangingState", () => {
      // Arrange
      const user = createActiveUser();
      user.deactivate(deactivationWithoutObligations());
      const before = accountStateOf(user);

      // Act & Assert
      expect(() =>
        user.updateProfile({ email: new Email("new@example.com") }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("updatePreferences_WhenPreferencesAreValid_ReplacesSportsAndRegions", () => {
      // Arrange
      const user = createActiveUser();

      // Act
      user.updatePreferences({
        preferredSports: new Set(["Tennis"]),
        preferredRegions: new Set(["West"]),
      });

      // Assert
      expect([...user.preferredSports]).toEqual(["Tennis"]);
      expect([...user.preferredRegions]).toEqual(["West"]);
    });

    test("updatePreferences_WhenRegionIsBlank_RejectsWithoutChangingState", () => {
      // Arrange
      const user = createActiveUser();
      const before = accountStateOf(user);

      // Act & Assert
      expect(() =>
        user.updatePreferences({
          preferredSports: new Set(["Tennis"]),
          preferredRegions: new Set([" "]),
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("updatePreferences_WhenAccountIsInactive_RejectsWithoutChangingState", () => {
      // Arrange
      const user = createActiveUser();
      user.deactivate(deactivationWithoutObligations());
      const before = accountStateOf(user);

      // Act & Assert
      expect(() =>
        user.updatePreferences({
          preferredSports: new Set(["Tennis"]),
          preferredRegions: new Set(["West"]),
        }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("preferredSports_WhenReturnedSetChanges_PreservesStoredPreferences", () => {
      // Arrange
      const user = new User(
        createTestUserDetails({
          userId: "owner",
          preferredSports: new Set(["Tennis"]),
        }),
      );
      const exposedSports = user.preferredSports as Set<string>;

      // Act
      exposedSports.clear();

      // Assert
      expect([...user.preferredSports]).toEqual(["Tennis"]);
    });

    test("preferredRegions_WhenReturnedSetChanges_PreservesStoredPreferences", () => {
      // Arrange
      const user = new User(
        createTestUserDetails({
          userId: "owner",
          preferredRegions: new Set(["West"]),
        }),
      );
      const exposedRegions = user.preferredRegions as Set<string>;

      // Act
      exposedRegions.clear();

      // Assert
      expect([...user.preferredRegions]).toEqual(["West"]);
    });
  });

  describe("Payout setup", () => {
    test("beginPayoutSetup_WhenNoSetupExists_CreatesPendingAccount", () => {
      // Arrange
      const user = createActiveUser();

      // Act
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });

      // Assert
      expect(user.payoutAccount?.setupStatus).toBe("PENDING");
      expect(user.payoutAccount?.payoutAccountId).toBe("account");
      expect(user.payoutAccount?.userId).toBe("owner");
    });

    test("beginPayoutSetup_WhenSetupIsPending_ThrowsInvalidState", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      const before = accountStateOf(user);

      // Act & Assert
      expect(() =>
        user.beginPayoutSetup({
          payoutAccountId: "replacement",
          providerAccountReference: "other-provider",
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("beginPayoutSetup_WhenSetupIsComplete_ThrowsInvalidState", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const before = accountStateOf(user);

      // Act & Assert
      expect(() =>
        user.beginPayoutSetup({
          payoutAccountId: "replacement",
          providerAccountReference: "other-provider",
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("beginPayoutSetup_WhenPreviousSetupFailed_AllowsReplacementToComplete", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.failPayoutSetup();

      // Act
      user.beginPayoutSetup({
        payoutAccountId: "replacement",
        providerAccountReference: "other-provider",
      });
      user.completePayoutSetup("replacement-bank");
      const destination = user.payoutDestination();

      // Assert
      expect(user.payoutAccount?.setupStatus).toBe("COMPLETE");
      expect(destination.payoutAccountId).toBe("replacement");
      expect(destination.bankAccountReference).toBe("replacement-bank");
    });

    test("completePayoutSetup_WhenSetupIsPending_ReplacesAccountWithCompletedCopy", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      const pendingAccount = user.payoutAccount;

      // Act
      user.completePayoutSetup("bank");
      const completedAccount = user.payoutAccount;

      // Assert
      expect(pendingAccount?.setupStatus).toBe("PENDING");
      expect(completedAccount).not.toBe(pendingAccount);
      expect(completedAccount?.setupStatus).toBe("COMPLETE");
      expect(completedAccount?.bankAccountReference).toBe("bank");
    });

    test("completePayoutSetup_WhenNoSetupExists_ThrowsPayoutAccountNotReady", () => {
      // Arrange
      const user = createActiveUser();

      // Act & Assert
      expect(() => user.completePayoutSetup("bank")).toThrow(
        expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
      );
    });

    test("completePayoutSetup_WhenBankReferenceIsBlank_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.completePayoutSetup(" ")).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("completePayoutSetup_WhenCompletedWithDifferentBank_ThrowsInvalidState", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.completePayoutSetup("different-bank")).toThrow(
        expect.objectContaining({ code: "INVALID_STATE" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("failPayoutSetup_WhenNoSetupExists_ThrowsPayoutAccountNotReady", () => {
      // Arrange
      const user = createActiveUser();

      // Act & Assert
      expect(() => user.failPayoutSetup()).toThrow(
        expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
      );
    });

    test("failPayoutSetup_WhenSetupIsComplete_ThrowsInvalidState", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.failPayoutSetup()).toThrow(
        expect.objectContaining({ code: "INVALID_STATE" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("payoutDestination_WhenNoSetupExists_ThrowsPayoutAccountNotReady", () => {
      // Arrange
      const user = createActiveUser();

      // Act & Assert
      expect(() => user.payoutDestination()).toThrow(
        expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
      );
    });

    test("payoutDestination_WhenSetupIsComplete_ReturnsFrozenDestination", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");

      // Act
      const destination = user.payoutDestination();

      // Assert
      expect(destination).toEqual({
        payoutAccountId: "account",
        userId: "owner",
        providerAccountReference: "provider",
        bankAccountReference: "bank",
      });
      expect(Object.isFrozen(destination)).toBe(true);
    });

    test("payoutDestination_WhenAccountIsInactive_ThrowsInactiveAccount", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      user.deactivate(deactivationWithoutObligations());

      // Act & Assert
      expect(() => user.payoutDestination()).toThrow(
        expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
      );
    });
  });

  describe("Deactivation", () => {
    test("deactivate_WhenAvailableBalanceIsPositive_ThrowsActiveObligations", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        availableBalance: Money.fromCents(1),
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenHeldBalanceIsPositive_ThrowsActiveObligations", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        heldBalance: Money.fromCents(1),
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveCommitmentsExist_ThrowsActiveObligations", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeCommitments: 1,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveCommitmentsAreNegative_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeCommitments: -1,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveCommitmentsAreFractional_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeCommitments: 0.5,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenUnsettledOwnedSessionsExist_ThrowsActiveObligations", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        unsettledOwnedSessions: 1,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenUnsettledOwnedSessionsAreNegative_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        unsettledOwnedSessions: -1,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenUnsettledOwnedSessionsAreFractional_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        unsettledOwnedSessions: 0.5,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenPendingPayoutsExist_ThrowsActiveObligations", () => {
      // Arrange
      const user = createActiveUser();
      const input = { ...deactivationWithoutObligations(), pendingPayouts: 1 };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenPendingPayoutsAreNegative_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = { ...deactivationWithoutObligations(), pendingPayouts: -1 };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenPendingPayoutsAreFractional_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        pendingPayouts: 0.5,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveOwnedGroupsExist_ThrowsActiveObligations", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeOwnedGroups: 1,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveOwnedGroupsAreNegative_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeOwnedGroups: -1,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveOwnedGroupsAreFractional_ThrowsInvalidInput", () => {
      // Arrange
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeOwnedGroups: 0.5,
      };
      const before = accountStateOf(user);

      // Act & Assert
      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenNoObligationsRemain_AnonymisesProfile", () => {
      // Arrange
      const user = createActiveUser();
      user.updatePreferences({
        preferredSports: new Set(["Tennis"]),
        preferredRegions: new Set(["West"]),
      });

      // Act
      user.deactivate(deactivationWithoutObligations());

      // Assert
      expect(user.accountStatus).toBe("INACTIVE");
      expect(user.email).toBeNull();
      expect([...user.preferredSports]).toEqual([]);
      expect([...user.preferredRegions]).toEqual([]);
    });

    test("deactivate_WhenPayoutSetupIsComplete_RetainsFinancialIdentity", () => {
      // Arrange
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const wallet = user.wallet;
      const payoutAccount = user.payoutAccount;

      // Act
      user.deactivate(deactivationWithoutObligations());

      // Assert
      expect(user.userId).toBe("owner");
      expect(user.wallet).toBe(wallet);
      expect(user.payoutAccount).toBe(payoutAccount);
      expect(user.payoutAccount?.bankAccountReference).toBe("bank");
    });

    test("deactivate_WhenAlreadyInactive_LeavesStateUnchanged", () => {
      // Arrange
      const user = createActiveUser();
      user.deactivate(deactivationWithoutObligations());
      const before = accountStateOf(user);

      // Act
      user.deactivate(deactivationWithoutObligations());

      // Assert
      expect(accountStateOf(user)).toEqual(before);
    });
  });
});

function createActiveUser(): User {
  return User.create({
    userId: "owner",
    email: new Email("owner@example.com"),
    walletId: "w-owner",
    now: userLoadedAt,
  });
}

function deactivationWithoutObligations(): DeactivationInput {
  return {
    availableBalance: Money.fromCents(0),
    heldBalance: Money.fromCents(0),
    activeCommitments: 0,
    unsettledOwnedSessions: 0,
    pendingPayouts: 0,
    activeOwnedGroups: 0,
  };
}

function accountStateOf(user: User) {
  return {
    email: user.email?.toString() ?? null,
    accountStatus: user.accountStatus,
    preferredSports: [...user.preferredSports],
    preferredRegions: [...user.preferredRegions],
    payoutAccount: user.payoutAccount && {
      payoutAccountId: user.payoutAccount.payoutAccountId,
      setupStatus: user.payoutAccount.setupStatus,
      bankAccountReference: user.payoutAccount.bankAccountReference,
    },
  };
}
