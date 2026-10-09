import { createWalletDependencies } from "@/use-case-config/wallet";
import type { WalletApiDependencies } from "./dependencies";

let initialization: Promise<WalletApiDependencies> | undefined;

/**
 * Share pending setup and reuse assembled dependencies within this instance.
 * Missing settings expose unavailable capabilities. Invalid setup clears the
 * promise for retry; configured infrastructure is shared across submissions.
 */
export async function getWalletDependencies(): Promise<WalletApiDependencies> {
  initialization ??= Promise.resolve()
    .then(() => createWalletDependencies())
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
