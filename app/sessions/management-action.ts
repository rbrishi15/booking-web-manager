import type { UUID } from "@/domain";
import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import type { SessionManagementDependencies } from "./management-dependencies";
import { getSessionManagementDependencies } from "./management-server-dependencies";
import { sessionVisibilityErrorResponse } from "./visibility-response";

export interface SessionManagementGetAction<Output> {
  /** Calls the action's use case with the authenticated booker ID. */
  readonly run: (dependencies: SessionManagementDependencies, bookerId: UUID) => Promise<Output>;
}

/**
 * Builds the parameterless GET handler for one session-management read. The route supplies
 * only its use-case call; this owns the shared HTTP policy: loading the cached dependencies,
 * authentication, domain error mapping and `no-store` responses.
 */
export function sessionManagementGetAction<Output>(
  action: SessionManagementGetAction<Output>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const dependencies = await loadDependencies(getSessionManagementDependencies);
      const bookerId = await requireUserId(request, dependencies.authenticate);
      const result = await action.run(dependencies, bookerId);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return sessionVisibilityErrorResponse(error);
    }
  };
}
