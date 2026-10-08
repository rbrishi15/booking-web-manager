import { createScheduledJobsDependencies } from "@/use-case-config/scheduled-jobs";
import type { ScheduledJobsDependencies } from "./scheduled-jobs-dependencies";

let initialization: Promise<ScheduledJobsDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getScheduledJobsDependencies(): Promise<ScheduledJobsDependencies> {
  initialization ??= Promise.resolve()
    .then(createScheduledJobsDependencies)
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
