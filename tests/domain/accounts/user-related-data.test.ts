import {
  Email,
  ReliabilityScore,
  User,
  type UserDetails,
  Wallet,
} from "@/domain";
import { describe, expect, test } from "vitest";
import { fundedWallet, loadedUserDetails, userLoadedAt } from "./user-fixtures";

describe("User", () => {
  test("constructor_WhenMembershipsAreMissing_ThrowsInvalidInput", () => {
    // Arrange
    const details = {
      ...loadedUserDetails("u"),
      memberGroupIds: undefined,
    } as unknown as UserDetails;

    // Act & Assert
    expect(() => new User(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenMembershipsAreNull_ThrowsInvalidInput", () => {
    // Arrange
    const details = {
      ...loadedUserDetails("u"),
      memberGroupIds: null,
    } as unknown as UserDetails;

    // Act & Assert
    expect(() => new User(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenWalletBelongsToAnotherUser_ThrowsInvalidInput", () => {
    // Arrange
    const details = {
      ...loadedUserDetails("u"),
      wallet: new Wallet({
        walletId: "w-u",
        userId: "other",
        transactions: [],
      }),
    } as unknown as UserDetails;

    // Act & Assert
    expect(() => new User(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenMembershipIdIsBlank_ThrowsInvalidInput", () => {
    // Arrange
    const details = {
      ...loadedUserDetails("u"),
      memberGroupIds: [" "],
    } as unknown as UserDetails;

    // Act & Assert
    expect(() => new User(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenMembershipsAreNotAnArray_ThrowsInvalidInput", () => {
    // Arrange
    const details = {
      ...loadedUserDetails("u"),
      memberGroupIds: new Set(["group"]),
    } as unknown as UserDetails;

    // Act & Assert
    expect(() => new User(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenLoadedDataIsMutated_PreservesProjectionsAndMemberships", () => {
    // Arrange
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

    // Act
    details.wallet = fundedWallet("u", 0);
    details.reliabilityScore = ReliabilityScore.from(0);
    memberGroupIds.push("other");
    (user.memberGroupIds as string[]).push("injected");

    // Assert
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

  test("create_WhenRegistering_EstablishesWalletAndEmptyHistory", () => {
    // Arrange
    const details = {
      userId: "new-user",
      email: new Email("new@example.com"),
      walletId: "new-wallet",
      now: userLoadedAt,
    };

    // Act
    const user = User.create(details);

    // Assert
    expect(user.wallet.userId).toBe(user.userId);
    expect(user.email?.toString()).toBe("new@example.com");
    expect(user.wallet.walletId).toBe("new-wallet");
    expect(user.wallet.transactions).toEqual([]);
    expect(user.wallet.getFunds().toCents()).toBe(0);
    expect(user.reliabilityScore.toNumber()).toBe(
      ReliabilityScore.fromHistory(user.userId, [], userLoadedAt).toNumber(),
    );
    expect(user.memberGroupIds).toEqual([]);
  });
});
