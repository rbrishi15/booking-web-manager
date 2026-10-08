import { createPushSubscriptionDependencies } from "@/use-case-config/push-subscriptions";
import type { PushSubscriptionDependencies } from "./push-subscription-dependencies";

let initialization: Promise<PushSubscriptionDependencies> | undefined;

/** Shares successful configuration and permits retry after setup failure. */
export function getPushSubscriptionDependencies(): Promise<PushSubscriptionDependencies> {
  initialization ??= Promise.resolve()
    .then(createPushSubscriptionDependencies)
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
