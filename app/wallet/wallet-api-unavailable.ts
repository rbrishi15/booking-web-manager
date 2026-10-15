export const WALLET_API_UNAVAILABLE_MESSAGE =
  "Wallet service is not available yet";

export class WalletApiUnavailableError extends Error {
  constructor(message: string = WALLET_API_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "WalletApiUnavailableError";
  }
}

export const TOP_UP_UNAVAILABLE_MESSAGE = "Top-ups are not available yet";

/** Stripe test-mode keys are missing; reading the wallet still works. */
export class TopUpUnavailableError extends Error {
  constructor(message: string = TOP_UP_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "TopUpUnavailableError";
  }
}
