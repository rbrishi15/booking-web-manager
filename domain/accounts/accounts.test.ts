import { describe, expect, test } from "vitest";
import { Money } from "../finance/money";
import { DomainError } from "../shared/errors";
import { PayoutAccount } from "./payout-account";
import { type DeactivationFacts, User } from "./user";

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

function expectRejectedUnchanged<T>(
  aggregate: { snapshot(): T },
  operation: () => unknown,
  code: string,
): void {
  const before = aggregate.snapshot();
  expect(operation).toThrow(DomainError);
  expect(operation).toThrow(expect.objectContaining({ code }));
  expect(aggregate.snapshot()).toEqual(before);
}

describe("User aggregate", () => {
  test("creates an active account and changes profile and preferences", () => {
    const user = newUser();
    expect(user.accountStatus).toBe("ACTIVE");
    expect(user.preferredSports.size).toBe(0);
    user.updateProfile({ email: "new@example.com" });
    user.updatePreferences({
      preferredSports: new Set(["Tennis"]),
      preferredRegions: new Set(["West"]),
    });
    expect(user.email).toBe("new@example.com");
    expect([...user.preferredSports]).toEqual(["Tennis"]);
    expect([...user.preferredRegions]).toEqual(["West"]);
  });

  test("copies incoming, outgoing, and reconstituted preference sets", () => {
    const sports = new Set(["Tennis"]);
    const user = User.create({
      userId: "owner",
      email: "owner@example.com",
      preferredSports: sports,
    });
    sports.clear();
    (user.preferredSports as Set<string>).clear();
    const snapshot = user.snapshot();
    const reloaded = User.reconstitute(snapshot);
    (snapshot.preferredSports as Set<string>).clear();
    expect([...user.preferredSports]).toEqual(["Tennis"]);
    expect([...reloaded.preferredSports]).toEqual(["Tennis"]);
  });

  test("rejects invalid profile and preference updates before changing state", () => {
    const user = newUser();
    expectRejectedUnchanged(
      user,
      () => user.updateProfile({ email: " " }),
      "INVALID_INPUT",
    );
    expectRejectedUnchanged(
      user,
      () =>
        user.updatePreferences({
          preferredSports: new Set(["Tennis"]),
          preferredRegions: new Set([" "]),
        }),
      "INVALID_INPUT",
    );
  });

  test("payout setup produces a frozen usable destination only after completion", () => {
    const user = newUser();
    expect(() => user.payoutDestination()).toThrow(
      expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
    );
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    expect(user.payoutAccount?.setupStatus).toBe("PENDING");
    expect(() => user.payoutDestination()).toThrow(DomainError);
    const pending = user.payoutAccount;
    user.completePayoutSetup("bank");
    expect(pending?.setupStatus).toBe("PENDING");
    expect(user.payoutAccount?.setupStatus).toBe("COMPLETE");
    expect(user.payoutDestination()).toEqual({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
      bankAccountReference: "bank",
    });
    expect(Object.isFrozen(user.payoutDestination())).toBe(true);
    expectRejectedUnchanged(
      user,
      () => user.failPayoutSetup(),
      "INVALID_STATE",
    );
    expectRejectedUnchanged(
      user,
      () => user.completePayoutSetup("different-bank"),
      "INVALID_STATE",
    );
  });

  test("failed payout setup can restart but pending setup cannot be overwritten", () => {
    const user = newUser();
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    expectRejectedUnchanged(
      user,
      () =>
        user.beginPayoutSetup({
          payoutAccountId: "other",
          providerAccountReference: "different",
        }),
      "INVALID_STATE",
    );
    user.failPayoutSetup();
    expect(user.payoutAccount?.setupStatus).toBe("FAILED");
    user.beginPayoutSetup({
      payoutAccountId: "replacement",
      providerAccountReference: "provider-2",
    });
    user.completePayoutSetup("bank-2");
    expect(user.payoutDestination().payoutAccountId).toBe("replacement");
  });

  test("setup commands require an existing setup and valid bank reference", () => {
    const user = newUser();
    expectRejectedUnchanged(
      user,
      () => user.completePayoutSetup("bank"),
      "PAYOUT_ACCOUNT_NOT_READY",
    );
    expectRejectedUnchanged(
      user,
      () => user.failPayoutSetup(),
      "PAYOUT_ACCOUNT_NOT_READY",
    );
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    expectRejectedUnchanged(
      user,
      () => user.completePayoutSetup(" "),
      "INVALID_INPUT",
    );
  });

  test.each(["availableBalance", "heldBalance"] as const)(
    "requires zero %s for deactivation",
    (field) => {
      const user = newUser();
      expectRejectedUnchanged(
        user,
        () => user.deactivate({ ...clearFacts(), [field]: Money.fromCents(1) }),
        "ACTIVE_OBLIGATIONS",
      );
    },
  );

  test.each([
    "activeCommitments",
    "unsettledOwnedSessions",
    "pendingPayouts",
    "activeOwnedGroups",
  ] as const)("checks %s before deactivation", (field) => {
    const user = newUser();
    expectRejectedUnchanged(
      user,
      () => user.deactivate({ ...clearFacts(), [field]: 1 }),
      "ACTIVE_OBLIGATIONS",
    );
    expectRejectedUnchanged(
      user,
      () => user.deactivate({ ...clearFacts(), [field]: -1 }),
      "INVALID_INPUT",
    );
    expectRejectedUnchanged(
      user,
      () => user.deactivate({ ...clearFacts(), [field]: 0.5 }),
      "INVALID_INPUT",
    );
  });

  test("deactivation anonymises profile, retains financial identity, and is repeatable", () => {
    const user = newUser();
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
    expect(user.accountStatus).toBe("INACTIVE");
    expect(user.email).toBeNull();
    expect(user.preferredSports.size).toBe(0);
    expect(user.preferredRegions.size).toBe(0);
    expect(user.payoutAccount?.bankAccountReference).toBe("bank");
    expect(User.reconstitute(user.snapshot()).snapshot()).toEqual(
      user.snapshot(),
    );
    expectRejectedUnchanged(
      user,
      () => user.updateProfile({ email: "new@example.com" }),
      "INACTIVE_ACCOUNT",
    );
    expectRejectedUnchanged(
      user,
      () =>
        user.updatePreferences({
          preferredSports: new Set(),
          preferredRegions: new Set(),
        }),
      "INACTIVE_ACCOUNT",
    );
    expect(() => user.payoutDestination()).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
  });

  test("reconstitution rejects foreign payout accounts and inconsistent account state", () => {
    const snapshot = newUser().snapshot();
    const payoutAccount = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "other-user",
      providerAccountReference: "provider",
    }).snapshot();
    expect(() => User.reconstitute({ ...snapshot, payoutAccount })).toThrow(
      DomainError,
    );
    expect(() =>
      User.reconstitute({ ...snapshot, accountStatus: "INACTIVE" }),
    ).toThrow(DomainError);
    expect(() => User.reconstitute({ ...snapshot, email: null })).toThrow(
      DomainError,
    );
  });
});
describe("PayoutAccount child entity", () => {
  test("transitions are immutable and completed setup accepts matching duplicate confirmation", () => {
    const pending = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
    });
    const completed = pending.completeSetup("bank");
    expect(pending.setupStatus).toBe("PENDING");
    expect(completed.completeSetup("bank").snapshot()).toEqual(
      completed.snapshot(),
    );
    expect(PayoutAccount.reconstitute(completed.snapshot()).snapshot()).toEqual(
      completed.snapshot(),
    );
    expect(() => pending.failSetup().completeSetup("bank")).toThrow(
      DomainError,
    );
  });

  test("reconstitution validates bank details against setup status", () => {
    const snapshot = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
    }).snapshot();
    expect(() =>
      PayoutAccount.reconstitute({ ...snapshot, setupStatus: "COMPLETE" }),
    ).toThrow(DomainError);
    expect(() =>
      PayoutAccount.reconstitute({ ...snapshot, bankAccountReference: "bank" }),
    ).toThrow(DomainError);
  });
});
