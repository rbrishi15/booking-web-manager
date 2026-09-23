import {
  createUserReliability,
  Money,
  ReliabilityScore,
  User,
  type UserDetails,
  Wallet,
} from "@/domain";

export const userLoadedAt = new Date("2026-10-08T10:00:00Z");

/** Existing state loaded from storage, including a funded ledger projection. */
export function loadedUserDetails(
  userId: string,
  overrides: Partial<UserDetails> = {},
): UserDetails {
  return {
    userId,
    email:
      overrides.accountStatus === "INACTIVE" ? null : `${userId}@example.com`,
    accountStatus: "ACTIVE",
    preferredSports: new Set(),
    preferredRegions: new Set(),
    wallet: new Wallet({ walletId: `w-${userId}`, userId }),
    walletBalance: {
      walletId: `w-${userId}`,
      availableBalance: Money.fromCents(10_000),
    },
    reliability: createUserReliability(
      userId,
      ReliabilityScore.from(100),
      userLoadedAt,
    ),
    memberGroupIds: [],
    ...overrides,
  };
}

export function loadedUser(
  userId: string,
  overrides: Partial<UserDetails> = {},
): User {
  return new User(loadedUserDetails(userId, overrides));
}
