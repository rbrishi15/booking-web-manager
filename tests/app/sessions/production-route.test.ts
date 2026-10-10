import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const network = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
  network.mockReset();
  network.mockRejectedValue(
    new Error("Production integration must not call a provider"),
  );
  vi.stubGlobal("fetch", network);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("production Create Session availability", () => {
  test.each([
    ["missing credentials", undefined, validRequestBody()],
    ["malformed credentials and JSON", "Basic invalid", "{"],
    [
      "bearer credentials and a valid submission",
      "Bearer access-token",
      validRequestBody(),
    ],
    [
      "a forged body identity",
      "Bearer access-token",
      JSON.stringify({
        ...JSON.parse(validRequestBody()),
        bookerId: "11111111-1111-4111-8111-111111111111",
      }),
    ],
  ])(
    "returns 503 for %s without reading the body or contacting a provider",
    async (_name, authorization, body) => {
      // Arrange
      const { POST } = await import("@/app/api/sessions/route");
      const incoming = request(body, authorization);
      const readBody = vi.spyOn(incoming, "json");

      // Act
      const response = await POST(incoming);

      // Assert
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "SESSION_API_UNAVAILABLE",
          message: "Session creation is not available yet",
        },
      });
      expect(readBody).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    },
  );

  test("configured credentials enable authentication without opening the database", async () => {
    // Arrange
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:password@localhost:54322/postgres",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    const { POST } = await import("@/app/api/sessions/route");

    // Act
    const response = await POST(request(validRequestBody()));

    // Assert
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
      },
    });
    expect(network).not.toHaveBeenCalled();
  });

  test.each([
    ["ACTIVE", 400, "INVALID_REQUEST"],
    ["INACTIVE", 403, "INACTIVE_ACCOUNT"],
    [null, 404, "NOT_FOUND"],
  ])(
    "configured bearer authentication checks a %s profile before parsing",
    async (status, expectedStatus, code) => {
      vi.stubEnv(
        "DATABASE_URL",
        "postgresql://user:password@localhost:54322/postgres",
      );
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
      network.mockResolvedValueOnce(
        Response.json({
          id: "11111111-1111-4111-8111-111111111111",
          email: "user@example.com",
          email_confirmed_at: "2026-01-01T00:00:00Z",
        }),
      );
      network.mockResolvedValueOnce(
        Response.json(status === null ? [] : [{ account_status: status }]),
      );
      const { POST } = await import("@/app/api/sessions/route");
      const response = await POST(request("{", "Bearer access-token"));
      expect(response.status).toBe(expectedStatus);
      expect((await response.json()).error.code).toBe(code);
      expect(network).toHaveBeenCalledTimes(2);
    },
  );

  test.each([
    ["missing", undefined, undefined],
    ["empty", "", "2026-01-01T00:00:00Z"],
  ])("rejects %s email on direct requests and identical retries before parsing or persistence", async (_label, email, confirmedAt) => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:54322/postgres");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    network.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return Response.json({
        id: "11111111-1111-4111-8111-111111111111", email, email_confirmed_at: confirmedAt,
      });
      if (url.includes("/rest/v1/profiles")) return Response.json([{ account_status: "ACTIVE" }]);
      throw new Error("Unexpected provider request");
    });
    const { POST } = await import("@/app/api/sessions/route");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const incoming = request(validRequestBody(), "Bearer access-token");
      const parse = vi.spyOn(incoming, "json");
      const response = await POST(incoming);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("EMAIL_REQUIRED");
      expect(parse).not.toHaveBeenCalled();
    }
    expect(network).toHaveBeenCalledTimes(4);
  });

  test("an unconfirmed email passes authentication and reaches request parsing", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:54322/postgres");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    network.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) return Response.json({
        id: "11111111-1111-4111-8111-111111111111", email: "user@example.com", email_confirmed_at: null,
      });
      if (url.includes("/rest/v1/profiles")) return Response.json([{ account_status: "ACTIVE" }]);
      throw new Error("Unexpected provider request");
    });
    const { POST } = await import("@/app/api/sessions/route");
    const incoming = request("{", "Bearer access-token");
    const response = await POST(incoming);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(network).toHaveBeenCalledTimes(2);
  });

  test("malformed configuration is an opaque setup failure and can be retried", async () => {
    vi.stubEnv("DATABASE_URL", "not-a-database-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    const { POST } = await import("@/app/api/sessions/route");
    const failure = await POST(request());
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:password@localhost:54322/postgres",
    );
    expect((await POST(request())).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  test("both production capabilities remain unavailable when called directly", async () => {
    // Arrange
    const { createSessionDependencies } = await import(
      "@/use-case-config/sessions"
    );
    const { SessionApiUnavailableError } = await import(
      "@/app/sessions/session-api-unavailable"
    );
    const dependencies = createSessionDependencies();

    // Act & Assert
    await expect(dependencies.authenticate(request())).rejects.toBeInstanceOf(
      SessionApiUnavailableError,
    );
    expect(() =>
      dependencies.createForSubmission({ idempotencyKey: "new-session" }),
    ).toThrow(SessionApiUnavailableError);
    expect(network).not.toHaveBeenCalled();
  });

  test("unavailable requests retain successfully assembled dependencies", async () => {
    // Arrange
    const { getSessionDependencies } = await import(
      "@/app/sessions/server-dependencies"
    );
    const { POST } = await import("@/app/api/sessions/route");
    const first = await getSessionDependencies();

    // Act
    const response = await POST(
      request(validRequestBody(), "Bearer access-token"),
    );
    const subsequent = await getSessionDependencies();

    // Assert
    expect(response.status).toBe(503);
    expect(subsequent).toBe(first);
    expect(network).not.toHaveBeenCalled();
  });
});

function validRequestBody(): string {
  return JSON.stringify({
    idempotencyKey: "new-session",
    booking: {
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: "2030-01-01T10:00:00Z",
      endAt: "2030-01-01T12:00:00Z",
      totalCostCents: 1001,
    },
    config: { totalSlots: 3, minimumHeadcount: 2 },
  });
}

function request(body?: string, authorization?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== undefined) headers.set("Authorization", authorization);
  return new Request("https://example.test/api/sessions", {
    method: "POST",
    headers,
    body,
  });
}
