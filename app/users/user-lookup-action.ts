import { createAuthenticatedActions } from "@/app/http/authenticated-action";
import { userLookupErrorResponse } from "./user-lookup-response";
import { getUserHandleDependencies } from "./user-handle-server-dependencies";

const actions = createAuthenticatedActions({
  getDependencies: getUserHandleDependencies,
  // 401 signed out, 400 malformed ID, 404 nobody active, 503 unconfigured, opaque 500 otherwise.
  errorResponse: userLookupErrorResponse,
});

/** Authenticated, uncached GET policy for finding players by user ID. */
export const userLookupGetAction = actions.get;
