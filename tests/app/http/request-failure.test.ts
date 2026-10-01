import { describe, expect, test } from "vitest";
import { invalidRequest, isRequestFailure, unauthenticated } from "@/app/http/request-failure";

describe("request failures", () => {
  test("represents invalid input as plain tagged data with the supplied message", () => {
    const failure = invalidRequest("Invalid discovery query");

    expect(failure).toEqual({
      kind: "request-failure", status: 400, code: "INVALID_REQUEST", message: "Invalid discovery query",
    });
    expect(failure).not.toBeInstanceOf(Error);
    expect(isRequestFailure(failure)).toBe(true);
  });

  test("preserves the unauthenticated response contract", () => {
    const failure = unauthenticated();

    expect(failure).toEqual({
      kind: "request-failure", status: 401, code: "UNAUTHENTICATED", message: "Authentication is required",
    });
    expect(isRequestFailure(failure)).toBe(true);
  });

  test.each([
    null, undefined, "error", new Error("Invalid input"), {},
    { status: 400, code: "INVALID_REQUEST", message: "Missing tag" },
    { kind: "request-failure", status: 500, code: "INVALID_REQUEST", message: "Wrong status" },
    { kind: "request-failure", status: 401, code: "INVALID_REQUEST", message: "Mismatched code" },
    { kind: "request-failure", status: 400, code: "INVALID_REQUEST", message: 123 },
  ])("does not recognize unrelated or malformed failure %j", (value) => {
    expect(isRequestFailure(value)).toBe(false);
  });
});
