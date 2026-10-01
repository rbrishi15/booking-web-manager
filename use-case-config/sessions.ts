import type { SessionApiDependencies } from "@/app/sessions/dependencies";
import { SessionApiUnavailableError } from "@/app/sessions/session-api-unavailable";

/** Assemble the API capabilities; production integration is deliberately pending. */
export function createSessionDependencies(): SessionApiDependencies {
  return {
    // TODO(Neoh): wire Joseph's approved auth after PR #20 lands on main.
    // See ./README.md for integration owners, prerequisites, and acceptance checks.
    authenticate: async () => {
      throw new SessionApiUnavailableError();
    },
    // TODO(Neoh): wire persistence after Rishi coordinates the prerequisite migrations.
    // See ./README.md for the integration checklist and complete-User requirements.
    createForSubmission: () => {
      throw new SessionApiUnavailableError();
    },
  };
}
