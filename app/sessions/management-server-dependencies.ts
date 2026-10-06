import { createSessionManagementDependencies } from "@/use-case-config/session-management";
import type { SessionManagementDependencies } from "./management-dependencies";

let initialization: Promise<SessionManagementDependencies> | undefined;

/** Shares lazy dependency initialization across callers and permits retry after initialization fails. */
export async function getSessionManagementDependencies(): Promise<SessionManagementDependencies> {
  initialization ??= Promise.resolve()
    .then(() => createSessionManagementDependencies())
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
