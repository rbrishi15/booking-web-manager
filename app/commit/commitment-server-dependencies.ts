import { createCommitmentDependencies } from "@/use-case-config/commitments";
import type { CommitmentDependencies } from "./commitment-dependencies";

let initialization: Promise<CommitmentDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getCommitmentDependencies(): Promise<CommitmentDependencies> {
  initialization ??= Promise.resolve()
    .then(createCommitmentDependencies)
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
