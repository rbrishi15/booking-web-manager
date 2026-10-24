import { createUserHandleDependencies } from "@/use-case-config/user-handles";
import type { UserHandleDependencies } from "./user-handle-dependencies";

let initialization: Promise<UserHandleDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getUserHandleDependencies(): Promise<UserHandleDependencies> {
  initialization ??= Promise.resolve()
    .then(createUserHandleDependencies)
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
