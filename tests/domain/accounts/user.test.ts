import {
  type DeactivationInput,
  Email,
  Money,
  PayoutAccount,
  User,
} from "@/domain";
import { describe, expect, test } from "vitest";
import { loadedUserDetails, userLoadedAt } from "./user-fixtures";

describe("User", () => {
  describe("Construction and registration", () => {
    test("constructor_WhenEmailIsProvided_PreservesTheEmailValue", () => {
      const email = new Email("Owner+bookings@Example.COM");
      const details = loadedUserDetails("owner", { email });

      const user = new User(details);

      expect(user.email).toBe(email);
      expect(user.email?.toString()).toBe("Owner+bookings@Example.COM");
    });

    test("constructor_WhenActiveAccountHasNoEmail_ThrowsInvalidInput", () => {
      const details = loadedUserDetails("owner", { email: null });

      expect(() => new User(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenInactiveAccountHasEmail_ThrowsInvalidInput", () => {
      const details = loadedUserDetails("owner", {
        accountStatus: "INACTIVE",
        email: new Email("owner@example.com"),
      });

      expect(() => new User(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenLoadingDeactivatedUser_RestoresAnonymisedProfile", () => {
      const original = createActiveUser();
      original.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      original.completePayoutSetup("bank");
      original.deactivate(deactivationWithoutObligations());
      const details = loadedUserDetails("owner", {
        accountStatus: "INACTIVE",
        email: null,
        payoutAccount: original.payoutAccount,
      });

      const restored = new User(details);

      expect(restored.accountStatus).toBe("INACTIVE");
      expect(restored.email).toBeNull();
      expect(accountStateOf(restored)).toEqual(accountStateOf(original));
    });

    test("constructor_WhenPayoutAccountBelongsToAnotherUser_ThrowsInvalidInput", () => {
      const payoutAccount = PayoutAccount.create({
        payoutAccountId: "account",
        userId: "other-user",
        providerAccountReference: "provider",
      });
      const details = loadedUserDetails("owner", { payoutAccount });

      expect(() => new User(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenSourcePreferencesChange_PreservesStoredPreferences", () => {
      const sports = new Set(["Tennis"]);
      const regions = new Set(["West"]);
      const user = new User(
        loadedUserDetails("owner", {
          preferredSports: sports,
          preferredRegions: regions,
        }),
      );

      sports.clear();
      regions.clear();

      expect([...user.preferredSports]).toEqual(["Tennis"]);
      expect([...user.preferredRegions]).toEqual(["West"]);
    });

    test("create_WhenRegistrationIsValid_ReturnsAnActiveUser", () => {
      const email = new Email("owner@example.com");

      const user = User.create({
        userId: "owner",
        email,
        walletId: "w-owner",
        now: userLoadedAt,
      });

      expect(user.accountStatus).toBe("ACTIVE");
      expect(user.email).toBe(email);
    });

    test("create_WhenSourcePreferencesChange_PreservesStoredPreferences", () => {
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

      sports.clear();
      regions.clear();

      expect([...user.preferredSports]).toEqual(["Tennis"]);
      expect([...user.preferredRegions]).toEqual(["West"]);
    });
  });

  describe("Profile and preferences", () => {
    test("updateProfile_WhenAccountIsActive_ReplacesEmail", () => {
      const user = createActiveUser();
      const email = new Email("new@example.com");

      user.updateProfile({ email });

      expect(user.email).toBe(email);
      expect(user.email?.toString()).toBe("new@example.com");
    });

    test("updateProfile_WhenAccountIsInactive_RejectsWithoutChangingState", () => {
      const user = createActiveUser();
      user.deactivate(deactivationWithoutObligations());
      const before = accountStateOf(user);

      expect(() =>
        user.updateProfile({ email: new Email("new@example.com") }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("updatePreferences_WhenPreferencesAreValid_ReplacesSportsAndRegions", () => {
      const user = createActiveUser();

      user.updatePreferences({
        preferredSports: new Set(["Tennis"]),
        preferredRegions: new Set(["West"]),
      });

      expect([...user.preferredSports]).toEqual(["Tennis"]);
      expect([...user.preferredRegions]).toEqual(["West"]);
    });

    test("updatePreferences_WhenRegionIsBlank_RejectsWithoutChangingState", () => {
      const user = createActiveUser();
      const before = accountStateOf(user);

      expect(() =>
        user.updatePreferences({
          preferredSports: new Set(["Tennis"]),
          preferredRegions: new Set([" "]),
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("updatePreferences_WhenAccountIsInactive_RejectsWithoutChangingState", () => {
      const user = createActiveUser();
      user.deactivate(deactivationWithoutObligations());
      const before = accountStateOf(user);

      expect(() =>
        user.updatePreferences({
          preferredSports: new Set(["Tennis"]),
          preferredRegions: new Set(["West"]),
        }),
      ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("preferredSports_WhenReturnedSetChanges_PreservesStoredPreferences", () => {
      const user = new User(
        loadedUserDetails("owner", { preferredSports: new Set(["Tennis"]) }),
      );
      const exposedSports = user.preferredSports as Set<string>;

      exposedSports.clear();

      expect([...user.preferredSports]).toEqual(["Tennis"]);
    });

    test("preferredRegions_WhenReturnedSetChanges_PreservesStoredPreferences", () => {
      const user = new User(
        loadedUserDetails("owner", { preferredRegions: new Set(["West"]) }),
      );
      const exposedRegions = user.preferredRegions as Set<string>;

      exposedRegions.clear();

      expect([...user.preferredRegions]).toEqual(["West"]);
    });
  });

  describe("Payout setup", () => {
    test("beginPayoutSetup_WhenNoSetupExists_CreatesPendingAccount", () => {
      const user = createActiveUser();

      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });

      expect(user.payoutAccount?.setupStatus).toBe("PENDING");
      expect(user.payoutAccount?.payoutAccountId).toBe("account");
      expect(user.payoutAccount?.userId).toBe("owner");
    });

    test("beginPayoutSetup_WhenSetupIsPending_ThrowsInvalidState", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      const before = accountStateOf(user);

      expect(() =>
        user.beginPayoutSetup({
          payoutAccountId: "replacement",
          providerAccountReference: "other-provider",
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("beginPayoutSetup_WhenSetupIsComplete_ThrowsInvalidState", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const before = accountStateOf(user);

      expect(() =>
        user.beginPayoutSetup({
          payoutAccountId: "replacement",
          providerAccountReference: "other-provider",
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(accountStateOf(user)).toEqual(before);
    });

    test("beginPayoutSetup_WhenPreviousSetupFailed_AllowsReplacementToComplete", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.failPayoutSetup();

      user.beginPayoutSetup({
        payoutAccountId: "replacement",
        providerAccountReference: "other-provider",
      });
      user.completePayoutSetup("replacement-bank");
      const destination = user.payoutDestination();

      expect(user.payoutAccount?.setupStatus).toBe("COMPLETE");
      expect(destination.payoutAccountId).toBe("replacement");
      expect(destination.bankAccountReference).toBe("replacement-bank");
    });

    test("completePayoutSetup_WhenSetupIsPending_ReplacesAccountWithCompletedCopy", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      const pendingAccount = user.payoutAccount;

      user.completePayoutSetup("bank");
      const completedAccount = user.payoutAccount;

      expect(pendingAccount?.setupStatus).toBe("PENDING");
      expect(completedAccount).not.toBe(pendingAccount);
      expect(completedAccount?.setupStatus).toBe("COMPLETE");
      expect(completedAccount?.bankAccountReference).toBe("bank");
    });

    test("completePayoutSetup_WhenNoSetupExists_ThrowsPayoutAccountNotReady", () => {
      const user = createActiveUser();

      expect(() => user.completePayoutSetup("bank")).toThrow(
        expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
      );
    });

    test("completePayoutSetup_WhenBankReferenceIsBlank_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      const before = accountStateOf(user);

      expect(() => user.completePayoutSetup(" ")).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("completePayoutSetup_WhenCompletedWithDifferentBank_ThrowsInvalidState", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const before = accountStateOf(user);

      expect(() => user.completePayoutSetup("different-bank")).toThrow(
        expect.objectContaining({ code: "INVALID_STATE" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("failPayoutSetup_WhenNoSetupExists_ThrowsPayoutAccountNotReady", () => {
      const user = createActiveUser();

      expect(() => user.failPayoutSetup()).toThrow(
        expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
      );
    });

    test("failPayoutSetup_WhenSetupIsComplete_ThrowsInvalidState", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const before = accountStateOf(user);

      expect(() => user.failPayoutSetup()).toThrow(
        expect.objectContaining({ code: "INVALID_STATE" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("payoutDestination_WhenNoSetupExists_ThrowsPayoutAccountNotReady", () => {
      const user = createActiveUser();

      expect(() => user.payoutDestination()).toThrow(
        expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
      );
    });

    test("payoutDestination_WhenSetupIsComplete_ReturnsFrozenDestination", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");

      const destination = user.payoutDestination();

      expect(destination).toEqual({
        payoutAccountId: "account",
        userId: "owner",
        providerAccountReference: "provider",
        bankAccountReference: "bank",
      });
      expect(Object.isFrozen(destination)).toBe(true);
    });

    test("payoutDestination_WhenAccountIsInactive_ThrowsInactiveAccount", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      user.deactivate(deactivationWithoutObligations());

      expect(() => user.payoutDestination()).toThrow(
        expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
      );
    });
  });

  describe("Deactivation", () => {
    test("deactivate_WhenAvailableBalanceIsPositive_ThrowsActiveObligations", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        availableBalance: Money.fromCents(1),
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenHeldBalanceIsPositive_ThrowsActiveObligations", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        heldBalance: Money.fromCents(1),
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveCommitmentsExist_ThrowsActiveObligations", () => {
      const user = createActiveUser();
      const input = { ...deactivationWithoutObligations(), activeCommitments: 1 };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveCommitmentsAreNegative_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeCommitments: -1,
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveCommitmentsAreFractional_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeCommitments: 0.5,
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenUnsettledOwnedSessionsExist_ThrowsActiveObligations", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        unsettledOwnedSessions: 1,
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenUnsettledOwnedSessionsAreNegative_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        unsettledOwnedSessions: -1,
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenUnsettledOwnedSessionsAreFractional_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        unsettledOwnedSessions: 0.5,
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenPendingPayoutsExist_ThrowsActiveObligations", () => {
      const user = createActiveUser();
      const input = { ...deactivationWithoutObligations(), pendingPayouts: 1 };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenPendingPayoutsAreNegative_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = { ...deactivationWithoutObligations(), pendingPayouts: -1 };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenPendingPayoutsAreFractional_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = { ...deactivationWithoutObligations(), pendingPayouts: 0.5 };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveOwnedGroupsExist_ThrowsActiveObligations", () => {
      const user = createActiveUser();
      const input = { ...deactivationWithoutObligations(), activeOwnedGroups: 1 };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveOwnedGroupsAreNegative_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeOwnedGroups: -1,
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenActiveOwnedGroupsAreFractional_ThrowsInvalidInput", () => {
      const user = createActiveUser();
      const input = {
        ...deactivationWithoutObligations(),
        activeOwnedGroups: 0.5,
      };
      const before = accountStateOf(user);

      expect(() => user.deactivate(input)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(accountStateOf(user)).toEqual(before);
    });

    test("deactivate_WhenNoObligationsRemain_AnonymisesProfile", () => {
      const user = createActiveUser();
      user.updatePreferences({
        preferredSports: new Set(["Tennis"]),
        preferredRegions: new Set(["West"]),
      });

      user.deactivate(deactivationWithoutObligations());

      expect(user.accountStatus).toBe("INACTIVE");
      expect(user.email).toBeNull();
      expect([...user.preferredSports]).toEqual([]);
      expect([...user.preferredRegions]).toEqual([]);
    });

    test("deactivate_WhenPayoutSetupIsComplete_RetainsFinancialIdentity", () => {
      const user = createActiveUser();
      user.beginPayoutSetup({
        payoutAccountId: "account",
        providerAccountReference: "provider",
      });
      user.completePayoutSetup("bank");
      const wallet = user.wallet;
      const payoutAccount = user.payoutAccount;

      user.deactivate(deactivationWithoutObligations());

      expect(user.userId).toBe("owner");
      expect(user.wallet).toBe(wallet);
      expect(user.payoutAccount).toBe(payoutAccount);
      expect(user.payoutAccount?.bankAccountReference).toBe("bank");
    });

    test("deactivate_WhenAlreadyInactive_LeavesStateUnchanged", () => {
      const user = createActiveUser();
      user.deactivate(deactivationWithoutObligations());
      const before = accountStateOf(user);

      user.deactivate(deactivationWithoutObligations());

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
