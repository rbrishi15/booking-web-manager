import {
  Email,
  LedgerTransaction,
  Money,
  ReliabilityScore,
  User,
  type UserDetails,
  Wallet,
} from "@/domain";

export const userLoadedAt = new Date("2026-10-08T10:00:00Z");

/** A wallet funded by a committed top-up, or an empty wallet for zero funds. */
export function fundedWallet(userId: string, cents = 10_000): Wallet {
  const walletId = `w-${userId}`;
  return new Wallet({
    walletId,
    userId,
    transactions:
      cents === 0
        ? []
        : [
            new LedgerTransaction({
              transactionId: `top-up-${userId}`,
              walletId,
              amount: Money.fromCents(cents),
              kind: "TOP_UP",
              occurredAt: userLoadedAt,
              idempotencyKey: `top-up-${userId}`,
            }),
          ],
  });
}

/** Existing state loaded from storage, including committed wallet transactions. */
export function loadedUserDetails(
  userId: string,
  overrides: Partial<UserDetails> = {},
): UserDetails {
  return {
    userId,
    email:
      overrides.accountStatus === "INACTIVE"
        ? null
        : new Email(`${userId}@example.com`),
    accountStatus: "ACTIVE",
    preferredSports: new Set(),
    preferredRegions: new Set(),
    wallet: fundedWallet(userId),
    reliabilityScore: ReliabilityScore.from(100),
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
