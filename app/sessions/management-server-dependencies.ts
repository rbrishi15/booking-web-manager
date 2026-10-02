import { createSessionManagementDependencies } from "@/use-case-config/session-management";
import type { SessionManagementDependencies } from "./management-dependencies";

let initialization: Promise<SessionManagementDependencies> | undefined;

export async function getSessionManagementDependencies(): Promise<SessionManagementDependencies> {
  initialization ??= Promise.resolve()
    .then(() => createSessionManagementDependencies())
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
