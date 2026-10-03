import { createSessionCancellationDependencies } from "@/use-case-config/cancellation";
import type { SessionCancellationDependencies } from "./cancellation-dependencies";

let initialization: Promise<SessionCancellationDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getSessionCancellationDependencies(): Promise<SessionCancellationDependencies> {
  initialization ??= Promise.resolve().then(createSessionCancellationDependencies).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
