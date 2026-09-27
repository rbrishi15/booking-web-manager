import {
  Email,
  LedgerTransaction,
  Money,
  PayoutAccount,
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

type TestUserOptions = Pick<UserDetails, "userId"> &
  Partial<Omit<UserDetails, "userId" | "wallet">> &
  (
    | { availableFundsCents?: number; wallet?: never }
    | { wallet: Wallet; availableFundsCents?: never }
  );

/**
 * Test defaults: active account, 10_000 available cents, reliability 100, no groups.
 * Supply a wallet instead of availableFundsCents when its history is the scenario.
 */
export function createTestUserDetails({
  userId,
  availableFundsCents = 10_000,
  wallet = fundedWallet(userId, availableFundsCents),
  ...overrides
}: TestUserOptions): UserDetails {
  return {
    userId,
    email:
      overrides.accountStatus === "INACTIVE"
        ? null
        : new Email(`${userId}@example.com`),
    accountStatus: "ACTIVE",
    preferredSports: new Set(),
    preferredRegions: new Set(),
    wallet,
    reliabilityScore: ReliabilityScore.from(100),
    memberGroupIds: [],
    ...overrides,
  };
}

/** Creates a real domain User with test data, without database or payment IO. */
export function createTestUser(options: TestUserOptions): User {
  return new User(createTestUserDetails(options));
}

export function readyBookerUser(userId = "booker"): User {
  return createTestUser({
    userId,
    payoutAccount: new PayoutAccount({
      payoutAccountId: "pa",
      userId,
      providerAccountReference: "provider",
      setupStatus: "COMPLETE",
      bankAccountReference: "bank",
    }),
  });
}
