import { loadDependencies } from "@/app/http/load-dependencies";
import type { CommitmentDependencies } from "./commitment-dependencies";
import { getCommitmentDependencies } from "./commitment-server-dependencies";
import { internalErrorResponse } from "./http";

/**
 * Loads the shared commitment dependencies and hands the request to one
 * action's handler. A setup failure is an opaque 500; an unconfigured server
 * still loads and its handlers answer 503.
 */
export async function serveCommitmentAction(
  request: Request,
  handle: (request: Request, dependencies: CommitmentDependencies) => Promise<Response>,
): Promise<Response> {
  let dependencies: CommitmentDependencies;
  try {
    dependencies = await loadDependencies(getCommitmentDependencies);
  } catch {
    return internalErrorResponse();
  }
  return handle(request, dependencies);
}
