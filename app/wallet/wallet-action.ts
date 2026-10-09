import type { UUID } from "@/domain";
import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { invalidRequest } from "@/app/http/request-failure";
import type { WalletApiDependencies } from "./dependencies";
import { getWalletDependencies } from "./server-dependencies";
import { walletErrorResponse } from "./wallet-response";
import { z } from "zod";

export interface WalletPostAction<Input, Output> {
  /** Validates the body and combines it with the authenticated user ID. */
  readonly parse: (userId: UUID, body: unknown) => Input;
  /** Calls the action's use case with the parsed input. */
  readonly run: (
    dependencies: WalletApiDependencies,
    input: Input,
  ) => Promise<Output>;
  /** Message for a body that fails validation. */
  readonly invalidRequestMessage: string;
  /** Defaults to 200. */
  readonly successStatus?: number;
}

export interface WalletGetAction<Output> {
  /** Calls the action's use case with the authenticated user ID. */
  readonly run: (
    dependencies: WalletApiDependencies,
    userId: UUID,
  ) => Promise<Output>;
}

export interface WalletQueryAction<Input, Output> {
  /** Validates the request query and combines it with the authenticated user ID. */
  readonly parse: (userId: UUID, request: Request) => Input;
  /** Calls the action's use case with the parsed query input. */
  readonly run: (
    dependencies: WalletApiDependencies,
    input: Input,
  ) => Promise<Output>;
  /** Message for a query that fails validation. */
  readonly invalidRequestMessage?: string;
}

/**
 * Builds the POST handler for one wallet action.
 * Owns the shared HTTP policy: loading cached dependencies, authentication,
 * JSON parsing, domain error mapping and `no-store` responses.
 */
export function walletAction<Input, Output>(
  action: WalletPostAction<Input, Output>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      const dependencies = await loadDependencies(getWalletDependencies);
      const userId = await requireUserId(request, dependencies.authenticate);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw invalidRequest("Request body must be valid JSON");
      }

      let input: Input;
      try {
        input = action.parse(userId, body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw invalidRequest(action.invalidRequestMessage);
        }
        throw error;
      }

      const result = await action.run(dependencies, input);
      return Response.json(result, {
        status: action.successStatus ?? 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return walletErrorResponse(error);
    }
  };
}

/**
 * Builds the parameterless GET handler for one wallet action.
 * Owns the shared HTTP policy: loading cached dependencies, authentication,
 * domain error mapping and `no-store` responses.
 */
export function walletGetAction<Output>(
  action: WalletGetAction<Output>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      const dependencies = await loadDependencies(getWalletDependencies);
      const userId = await requireUserId(request, dependencies.authenticate);
      const result = await action.run(dependencies, userId);
      return Response.json(result, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return walletErrorResponse(error);
    }
  };
}

/**
 * Builds the query-parameter GET handler for one wallet action.
 * Owns the shared HTTP policy: loading cached dependencies, authentication,
 * query parameter parsing, domain error mapping and `no-store` responses.
 */
export function walletQueryAction<Input, Output>(
  action: WalletQueryAction<Input, Output>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      const dependencies = await loadDependencies(getWalletDependencies);
      const userId = await requireUserId(request, dependencies.authenticate);

      let input: Input;
      try {
        input = action.parse(userId, request);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw invalidRequest(
            action.invalidRequestMessage ?? "Invalid request parameters",
          );
        }
        throw error;
      }

      const result = await action.run(dependencies, input);
      return Response.json(result, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return walletErrorResponse(error);
    }
  };
}
