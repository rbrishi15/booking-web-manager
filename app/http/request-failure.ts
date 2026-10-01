type RequestFailure = {
  readonly kind: "request-failure";
  readonly message: string;
} & (
  | { readonly status: 400; readonly code: "INVALID_REQUEST" }
  | { readonly status: 401; readonly code: "UNAUTHENTICATED" }
);

export function invalidRequest(message: string): RequestFailure {
  return { kind: "request-failure", status: 400, code: "INVALID_REQUEST", message };
}

export function unauthenticated(): RequestFailure {
  return {
    kind: "request-failure",
    status: 401,
    code: "UNAUTHENTICATED",
    message: "Authentication is required",
  };
}

export function isRequestFailure(value: unknown): value is RequestFailure {
  return value !== null && typeof value === "object" &&
    "kind" in value && value.kind === "request-failure" &&
    "message" in value && typeof value.message === "string" &&
    "status" in value && "code" in value &&
    ((value.status === 400 && value.code === "INVALID_REQUEST") ||
      (value.status === 401 && value.code === "UNAUTHENTICATED"));
}
