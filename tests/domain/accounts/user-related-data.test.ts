import {
  Money,
  ReliabilityScore,
  ReliabilityService,
  User,
  type UserDetails,
  Wallet,
} from "@/domain";
import { describe, expect, test } from "vitest";
import { loadedUserDetails, userLoadedAt } from "./user-fixtures";

describe("User related data", () => {
  test("registration establishes a wallet and the empty-history defaults", () => {
    const now = new Date(userLoadedAt);
    const user = User.create({
      userId: "new-user",
      email: "new@example.com",
      walletId: "new-wallet",
      now,
    });
    now.setTime(0);

    expect(user.wallet.userId).toBe(user.userId);
    expect(user.wallet.walletId).toBe("new-wallet");
    expect(user.walletBalance.walletId).toBe("new-wallet");
    expect(user.walletBalance.availableBalance.toCents()).toBe(0);
    expect(user.reliability.userId).toBe(user.userId);
    expect(user.reliability.reliabilityScore.toNumber()).toBe(
      new ReliabilityService()
        .recalculate(user.userId, [], userLoadedAt)
        .toNumber(),
    );
    expect(user.reliability.calculatedAt.getTime()).toBe(
      userLoadedAt.getTime(),
    );
    expect(user.memberGroupIds).toEqual([]);
  });

  test.each([
    "wallet",
    "walletBalance",
    "reliability",
    "memberGroupIds",
  ] as const)("requires %s when hydrating a user", (field) => {
    const details = loadedUserDetails("u");
    const missing = {
      ...details,
      [field]: undefined,
    } as unknown as UserDetails;
    const empty = { ...details, [field]: null } as unknown as UserDetails;

    expect(() => new User(missing)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(() => new User(empty)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  const details = loadedUserDetails("u");
  test.each<[string, Record<string, unknown>]>([
    [
      "foreign wallet",
      { wallet: new Wallet({ walletId: "w-u", userId: "other" }) },
    ],
    ["plain wallet object", { wallet: { walletId: "w-u", userId: "u" } }],
    [
      "foreign wallet balance",
      { walletBalance: { ...details.walletBalance, walletId: "other" } },
    ],
    [
      "negative balance",
      {
        walletBalance: {
          walletId: "w-u",
          availableBalance: Money.fromCents(-1),
        },
      },
    ],
    [
      "primitive balance",
      { walletBalance: { walletId: "w-u", availableBalance: 100 } },
    ],
    [
      "foreign reliability",
      { reliability: { ...details.reliability, userId: "other" } },
    ],
    [
      "primitive score",
      { reliability: { ...details.reliability, reliabilityScore: 100 } },
    ],
    [
      "missing calculation date",
      { reliability: { ...details.reliability, calculatedAt: undefined } },
    ],
    [
      "invalid calculation date",
      { reliability: { ...details.reliability, calculatedAt: new Date(NaN) } },
    ],
    ["empty membership ID", { memberGroupIds: [" "] }],
    ["non-string membership ID", { memberGroupIds: [123] }],
    ["non-array memberships", { memberGroupIds: new Set(["group"]) }],
  ])("rejects %s during hydration", (_name, patch) => {
    expect(() => new User({ ...details, ...patch } as UserDetails)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("isolates loaded projections and memberships from mutations", () => {
    const walletBalance = {
      walletId: "w-u",
      availableBalance: Money.fromCents(700),
    };
    const calculatedAt = new Date(userLoadedAt);
    const reliability = {
      userId: "u",
      reliabilityScore: ReliabilityScore.from(80),
      calculatedAt,
    };
    const memberGroupIds = ["group"];
    const user = new User(
      loadedUserDetails("u", { walletBalance, reliability, memberGroupIds }),
    );

    walletBalance.walletId = "other";
    walletBalance.availableBalance = Money.fromCents(0);
    reliability.userId = "other";
    reliability.reliabilityScore = ReliabilityScore.from(0);
    calculatedAt.setTime(0);
    memberGroupIds.push("other");
    (user.memberGroupIds as string[]).push("injected");
    user.reliability.calculatedAt.setTime(0);

    expect(
      Reflect.set(user.walletBalance, "availableBalance", Money.fromCents(0)),
    ).toBe(false);
    expect(
      Reflect.set(
        user.reliability,
        "reliabilityScore",
        ReliabilityScore.from(0),
      ),
    ).toBe(false);
    expect(user.walletBalance.walletId).toBe("w-u");
    expect(user.walletBalance.availableBalance.toCents()).toBe(700);
    expect(user.reliability.userId).toBe("u");
    expect(user.reliability.reliabilityScore.toNumber()).toBe(80);
    expect(user.reliability.calculatedAt.getTime()).toBe(
      userLoadedAt.getTime(),
    );
    expect(user.memberGroupIds).toEqual(["group"]);
  });
});
