export const WALLET_API_UNAVAILABLE_MESSAGE =
  "Wallet service is not available yet";

export class WalletApiUnavailableError extends Error {
  constructor(message: string = WALLET_API_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "WalletApiUnavailableError";
  }
}
