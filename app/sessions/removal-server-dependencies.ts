import { createSessionRemovalDependencies } from "@/use-case-config/removal";
import type { SessionRemovalDependencies } from "./removal-dependencies";

let initialization: Promise<SessionRemovalDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getSessionRemovalDependencies(): Promise<SessionRemovalDependencies> {
  initialization ??= Promise.resolve().then(createSessionRemovalDependencies).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
