import type { WalletSummary, WalletTransactionsPage } from "../wallet-transport";

/** Shared story data for the wallet view and controller. */
export const walletSummary: WalletSummary = {
  availableBalanceCents: 2500,
  heldBalanceCents: 1875,
  activeHolds: [
    { holdId: "h1", sessionId: "s1", heldCents: 1250, originalCents: 1250, venueName: "Bishan Sports Hall", sport: "Badminton", startAt: "2045-04-02T10:00:00Z" },
    { holdId: "h2", sessionId: "s2", heldCents: 625, originalCents: 1250, venueName: "Jurong East Sports Hall", sport: "Tennis", startAt: "2045-04-05T02:00:00Z" },
  ],
};

export const firstTransactionsPage: WalletTransactionsPage = {
  items: [
    { transactionId: "t3", kind: "LOCK", amountCents: 1250, occurredAt: "2045-04-01T12:00:00Z" },
    { transactionId: "t2", kind: "REFUND", amountCents: 900, occurredAt: "2045-03-30T08:00:00Z" },
  ],
  nextCursor: "2045-03-30T08:00:00Z",
};

/** The boundary row repeats, as a timestamp cursor can return it again. */
export const secondTransactionsPage: WalletTransactionsPage = {
  items: [
    { transactionId: "t2", kind: "REFUND", amountCents: 900, occurredAt: "2045-03-30T08:00:00Z" },
    { transactionId: "t1", kind: "TOP_UP", amountCents: 5000, occurredAt: "2045-03-29T08:00:00Z" },
  ],
  nextCursor: null,
};
