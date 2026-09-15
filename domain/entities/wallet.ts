import { requireDomain } from "../errors";
import type { UUID } from "../types";

export interface WalletSnapshot {
  readonly walletId: UUID;
  readonly userId: UUID;
}

/** Wallet identity. Balances are projections of the append-only ledger. */
export class Wallet {
  readonly #snapshot: WalletSnapshot;
  private constructor(snapshot: WalletSnapshot) {
    this.#snapshot = Object.freeze({ ...snapshot });
  }
  static create(props: WalletSnapshot): Wallet {
    validate(props.walletId, "walletId");
    validate(props.userId, "userId");
    return new Wallet(props);
  }
  static reconstitute(snapshot: WalletSnapshot): Wallet {
    return Wallet.create(snapshot);
  }
  snapshot(): WalletSnapshot {
    return { ...this.#snapshot };
  }
  get walletId(): UUID {
    return this.#snapshot.walletId;
  }
  get userId(): UUID {
    return this.#snapshot.userId;
  }
}
function validate(value: string, name: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
export type WalletProps = WalletSnapshot;
