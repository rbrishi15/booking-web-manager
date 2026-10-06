import { createWithdrawalPreviewDependencies } from "@/use-case-config/withdrawal-preview";
import type { WithdrawalPreviewDependencies } from "./withdrawal-preview-dependencies";

let initialization: Promise<WithdrawalPreviewDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getWithdrawalPreviewDependencies(): Promise<WithdrawalPreviewDependencies> {
  initialization ??= Promise.resolve()
    .then(createWithdrawalPreviewDependencies)
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
