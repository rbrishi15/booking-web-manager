import { ReliabilityScore, User, type UserDetails, Wallet } from "@/domain";
import { describe, expect, test } from "vitest";
import { fundedWallet, loadedUserDetails, userLoadedAt } from "./user-fixtures";

describe("User related data", () => {
  test("registration establishes a wallet and the empty-history defaults", () => {
    const user = User.create({
      userId: "new-user",
      email: "new@example.com",
      walletId: "new-wallet",
      now: userLoadedAt,
    });

    expect(user.wallet.userId).toBe(user.userId);
    expect(user.wallet.walletId).toBe("new-wallet");
    expect(user.wallet.transactions).toEqual([]);
    expect(user.wallet.getFunds().toCents()).toBe(0);
    expect(user.reliabilityScore.toNumber()).toBe(
      ReliabilityScore.fromHistory(user.userId, [], userLoadedAt).toNumber(),
    );
    expect(user.memberGroupIds).toEqual([]);
  });

  test.each(["wallet", "reliabilityScore", "memberGroupIds"] as const)(
    "requires %s when hydrating a user",
    (field) => {
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
    },
  );

  test.each<[string, Record<string, unknown>]>([
    [
      "foreign wallet",
      {
        wallet: new Wallet({
          walletId: "w-u",
          userId: "other",
          transactions: [],
        }),
      },
    ],
    ["plain wallet object", { wallet: { walletId: "w-u", userId: "u" } }],
    ["primitive score", { reliabilityScore: 100 }],
    ["plain score object", { reliabilityScore: { value: 100 } }],
    ["empty membership ID", { memberGroupIds: [" "] }],
    ["non-string membership ID", { memberGroupIds: [123] }],
    ["non-array memberships", { memberGroupIds: new Set(["group"]) }],
  ])("rejects %s during hydration", (_name, patch) => {
    const details = loadedUserDetails("u");
    expect(() => new User({ ...details, ...patch } as UserDetails)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("isolates loaded projections and memberships from mutations", () => {
    const wallet = fundedWallet("u", 700);
    const reliabilityScore = ReliabilityScore.from(80);
    const memberGroupIds = ["group"];
    const details = {
      ...loadedUserDetails("u"),
      wallet,
      reliabilityScore,
      memberGroupIds,
    };
    const user = new User(details);

    details.wallet = fundedWallet("u", 0);
    details.reliabilityScore = ReliabilityScore.from(0);
    memberGroupIds.push("other");
    (user.memberGroupIds as string[]).push("injected");

    expect(Reflect.set(user, "wallet", fundedWallet("u", 0))).toBe(false);
    expect(
      Reflect.set(user, "reliabilityScore", ReliabilityScore.from(0)),
    ).toBe(false);
    expect(user.wallet.walletId).toBe("w-u");
    expect(user.wallet.getFunds().toCents()).toBe(700);
    expect(user.reliabilityScore).toBe(reliabilityScore);
    expect(user.reliabilityScore.toNumber()).toBe(80);
    expect(user.memberGroupIds).toEqual(["group"]);
  });
});
