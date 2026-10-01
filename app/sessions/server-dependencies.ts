import { createSessionDependencies } from "@/use-case-config/sessions";
import type { SessionApiDependencies } from "./dependencies";
import { readSessionServerSettings } from "./server-environment";

let initialization: Promise<SessionApiDependencies> | undefined;

/**
 * Share pending setup and reuse assembled dependencies within this instance.
 * Awaiting this does not open the database pool; infrastructure keeps it lazy.
 */
export async function getSessionDependencies(): Promise<SessionApiDependencies> {
  // Cache the promise before assembly runs so concurrent calls share even the first attempt.
  initialization ??= Promise.resolve()
    .then(() => {
      const settings = readSessionServerSettings();
      return createSessionDependencies(settings);
    })
    .catch((error) => {
      // Only failed setup is retried; later request failures do not invalidate this cache.
      initialization = undefined;
      throw error;
    });
  return initialization;
}
