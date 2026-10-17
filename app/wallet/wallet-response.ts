import { DomainError } from "@/domain";
import { isRequestFailure } from "@/app/http/request-failure";
import {
  TOP_UP_UNAVAILABLE_MESSAGE,
  TopUpUnavailableError,
  WALLET_API_UNAVAILABLE_MESSAGE,
  WalletApiUnavailableError,
} from "./wallet-api-unavailable";

const domainErrorStatuses: Partial<Record<DomainError["code"], number>> = {
  INVALID_INPUT: 422,
  INACTIVE_ACCOUNT: 403,
  EMAIL_REQUIRED: 403,
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  DUPLICATE_ID: 409,
};

export function walletErrorResponse(error: unknown): Response {
  if (isRequestFailure(error)) {
    return errorResponse(error.status, error.code, error.message);
  }
  if (error instanceof TopUpUnavailableError) {
    return errorResponse(503, "TOP_UP_UNAVAILABLE", TOP_UP_UNAVAILABLE_MESSAGE);
  }
  if (error instanceof WalletApiUnavailableError) {
    return errorResponse(
      503,
      "WALLET_API_UNAVAILABLE",
      WALLET_API_UNAVAILABLE_MESSAGE,
    );
  }
  if (error instanceof DomainError) {
    const status = domainErrorStatuses[error.code];
    if (status !== undefined) {
      return errorResponse(status, error.code, error.message);
    }
  }
  return internalErrorResponse();
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function internalErrorResponse(): Response {
  return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
}
