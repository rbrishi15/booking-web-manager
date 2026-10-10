import type { UUID } from "@/domain";
import { loadDependencies } from "@/app/http/load-dependencies";
import type { CommitmentDependencies } from "./commitment-dependencies";
import { getCommitmentDependencies } from "./commitment-server-dependencies";
import { handleAuthenticatedJson, handleAuthenticatedRead, internalErrorResponse } from "./http";

export interface CommitmentAction<Input, Output> {
  /** Validates the body and combines it with the authenticated user ID. */
  readonly parse: (userId: UUID, body: unknown) => Input;
  /** Calls the action's use case with the parsed input. */
  readonly run: (dependencies: CommitmentDependencies, input: Input) => Promise<Output>;
  /** Message for a body that fails validation. */
  readonly invalidRequestMessage: string;
  /** Defaults to 200. */
  readonly successStatus?: number;
}

/**
 * Builds the POST handler for one commitment action. The route supplies only
 * its validation and use-case call; this owns the shared HTTP policy: loading
 * the cached dependencies (an unexpected setup failure is an opaque 500, an
 * unconfigured server answers 503), authentication, JSON parsing, domain
 * error mapping and `no-store` responses (see `handleAuthenticatedJson`).
 */
export function commitmentAction<Input, Output>(
  action: CommitmentAction<Input, Output>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let dependencies: CommitmentDependencies;
    try {
      dependencies = await loadDependencies(getCommitmentDependencies);
    } catch {
      return internalErrorResponse();
    }
    return handleAuthenticatedJson(request, {
      authenticate: dependencies.authenticate,
      parse: action.parse,
      run: (input) => action.run(dependencies, input),
      successStatus: action.successStatus ?? 200,
      invalidRequestMessage: action.invalidRequestMessage,
    });
  };
}

export interface CommitmentQuery<Output> {
  /** Calls the read's use case with the authenticated user ID. */
  readonly run: (dependencies: CommitmentDependencies, userId: UUID) => Promise<Output>;
}

/**
 * Builds the GET handler for one commitment read, with the same shared HTTP policy as
 * `commitmentAction`: cached dependencies, authentication, domain error mapping and
 * `no-store` responses (see `handleAuthenticatedRead`).
 */
export function commitmentQuery<Output>(
  query: CommitmentQuery<Output>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let dependencies: CommitmentDependencies;
    try {
      dependencies = await loadDependencies(getCommitmentDependencies);
    } catch {
      return internalErrorResponse();
    }
    return handleAuthenticatedRead(request, {
      authenticate: dependencies.authenticate,
      run: (userId) => query.run(dependencies, userId),
    });
  };
}
