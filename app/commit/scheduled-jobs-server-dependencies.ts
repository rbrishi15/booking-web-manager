import { createScheduledJobsDependencies } from "@/use-case-config/scheduled-jobs";
import type { ScheduledJobsHttpDependencies } from "./scheduled-jobs-handler";

let initialization: Promise<ScheduledJobsHttpDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getScheduledJobsDependencies(): Promise<ScheduledJobsHttpDependencies> {
  initialization ??= Promise.resolve()
    .then(createScheduledJobsDependencies)
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
