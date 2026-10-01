import { createSessionDependencies } from "@/use-case-config/sessions";
import type { SessionApiDependencies } from "./dependencies";

let initialization: Promise<SessionApiDependencies> | undefined;

/**
 * Share pending setup and reuse assembled dependencies within this instance.
 * Missing settings expose unavailable capabilities. Invalid setup clears the
 * promise for retry; configured infrastructure is shared across submissions.
 */
export async function getSessionDependencies(): Promise<SessionApiDependencies> {
  // Cache the promise before assembly runs so concurrent calls share even the first attempt.
  initialization ??= Promise.resolve()
    .then(() => createSessionDependencies())
    .catch((error) => {
      // Only failed setup is retried; later request failures do not invalidate this cache.
      initialization = undefined;
      throw error;
    });
  return initialization;
}
