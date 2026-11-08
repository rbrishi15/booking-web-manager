import { createSessionEditingDependencies } from "@/use-case-config/session-editing";
import type { SessionEditingDependencies } from "./editing-dependencies";

let initialization: Promise<SessionEditingDependencies> | undefined;
export function getSessionEditingDependencies(): Promise<SessionEditingDependencies> {
  initialization ??= Promise.resolve().then(createSessionEditingDependencies).catch((error) => {
    initialization = undefined; throw error;
  });
  return initialization;
}
