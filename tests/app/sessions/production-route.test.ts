import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const database = vi.hoisted(() => ({
  Pool: vi.fn(function unavailableDatabase() {
    throw new Error("private-database-connection-failure");
  }),
}));

vi.mock("pg", () => ({ Pool: database.Pool }));

beforeEach(() => {
  vi.resetModules();
  database.Pool.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("production Create Session route", () => {
  test("can be imported before server settings are available", async () => {
    // Arrange
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);

    // Act
    const route = await import("@/app/api/sessions/route");

    // Assert
    expect(route.POST).toBeTypeOf("function");
    expect(database.Pool).not.toHaveBeenCalled();
  });

  test("returns an opaque configuration failure and recovers when settings are corrected", async () => {
    // Arrange
    configureServerEnvironment();
    vi.stubEnv("DATABASE_URL", "private-invalid-database-setting");
    const { POST } = await import("@/app/api/sessions/route");

    // Act
    const failed = await POST(request());
    configureServerEnvironment();
    const recovered = await POST(request());

    // Assert
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(recovered.status).toBe(401);
    expect(await recovered.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(database.Pool).not.toHaveBeenCalled();
  });

  test("reuses successfully configured dependencies on later requests", async () => {
    // Arrange
    configureServerEnvironment();
    const { POST } = await import("@/app/api/sessions/route");
    const first = await POST(request());
    vi.stubEnv("DATABASE_URL", "invalid-settings-after-initialization");

    // Act
    const subsequent = await POST(request());

    // Assert
    expect(first.status).toBe(401);
    expect(subsequent.status).toBe(401);
    expect(await subsequent.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(database.Pool).not.toHaveBeenCalled();
  });

  test.each([
    ["DATABASE_URL", "postgresql://user:private-password@database.example.test/postgres"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://supabase.example.test"],
  ])("rejects insecure %s settings before authentication or database IO", async (name, value) => {
    // Arrange
    configureServerEnvironment();
    vi.stubEnv(name, value);
    const authFetch = mockVerifiedAuthentication();
    const { POST } = await import("@/app/api/sessions/route");

    // Act
    const response = await POST(request(validRequestBody(), "Bearer verified-access-token"));

    // Assert
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(authFetch).not.toHaveBeenCalled();
    expect(database.Pool).not.toHaveBeenCalled();
  });

  test("rejects missing or malformed bearer credentials without auth or database IO", async () => {
    // Arrange
    configureServerEnvironment();
    const authFetch = mockVerifiedAuthentication();
    const { POST } = await import("@/app/api/sessions/route");

    // Act
    const missing = await POST(request());
    const malformed = await POST(request("{}", "Basic not-a-bearer-token"));

    // Assert
    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(authFetch).not.toHaveBeenCalled();
    expect(database.Pool).not.toHaveBeenCalled();
  });

  test.each([
    ["an inactive profile", () => Response.json([{ account_status: "INACTIVE" }]), 403, "INACTIVE_ACCOUNT"],
    ["a missing profile", () => Response.json([]), 404, "NOT_FOUND"],
    ["a failed profile lookup", () => Response.json({ code: "XX000", message: "private-profile-lookup-failure" }, { status: 500 }), 500, "INTERNAL_ERROR"],
  ] as const)("rejects %s before parsing or opening the database", async (_name, profileResponse, status, code) => {
    // Arrange
    configureServerEnvironment();
    const readProfile = vi.fn(profileResponse);
    mockVerifiedAuthentication(readProfile);
    const { POST } = await import("@/app/api/sessions/route");

    // Act
    const response = await POST(request("{", "Bearer verified-access-token"));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ error: { code } });
    expect(JSON.stringify(body)).not.toContain("private-profile-lookup-failure");
    expect(readProfile).toHaveBeenCalledOnce();
    expect(database.Pool).not.toHaveBeenCalled();
  });

  test("checks the profile using the verified user's bearer identity", async () => {
    // Arrange
    configureServerEnvironment();
    const readProfile = vi.fn((profileRequest: Request) => {
      expect(profileRequest.headers.get("Authorization")).toBe("Bearer verified-access-token");
      const url = new URL(profileRequest.url);
      expect(url.searchParams.get("user_id")).toBe("eq.11111111-1111-4111-8111-111111111111");
      return Response.json([{ account_status: "ACTIVE" }]);
    });
    mockVerifiedAuthentication(readProfile);
    const { POST } = await import("@/app/api/sessions/route");

    // Act
    const response = await POST(request("{}", "Bearer verified-access-token"));

    // Assert
    expect(response.status).toBe(400);
    expect(readProfile).toHaveBeenCalledOnce();
    expect(database.Pool).not.toHaveBeenCalled();
  });

  test.each([
    ["malformed JSON", "{"],
    ["an invalid request schema", "{}"],
    ["an oversized idempotency key", validRequestBody("k".repeat(201))],
  ])(
    "rejects %s after authentication without constructing a database pool",
    async (_name, body) => {
      // Arrange
      configureServerEnvironment();
      mockVerifiedAuthentication();
      const { POST } = await import("@/app/api/sessions/route");

      // Act
      const response = await POST(
        request(body, "Bearer verified-access-token"),
      );

      // Assert
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
      expect(database.Pool).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["an ordinary key", "new-session"],
    ["a key at the maximum length", "k".repeat(200)],
  ])("opens the database for a valid authenticated submission with %s and hides connection failures", async (_name, idempotencyKey) => {
    // Arrange
    configureServerEnvironment();
    mockVerifiedAuthentication();
    const { POST } = await import("@/app/api/sessions/route");
    const body = validRequestBody(idempotencyKey);

    // Act
    const response = await POST(request(body, "Bearer verified-access-token"));

    // Assert
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(database.Pool).toHaveBeenCalledOnce();
  });
});

function validRequestBody(idempotencyKey = "new-session"): string {
  return JSON.stringify({
    idempotencyKey,
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

function configureServerEnvironment() {
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://user:password@localhost:54322/postgres",
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
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

function mockVerifiedAuthentication(
  readProfile: (request: Request) => Response = () =>
    Response.json([{ account_status: "ACTIVE" }]),
) {
  const authFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (input, init) => {
      const providerRequest = new Request(input, init);
      if (new URL(providerRequest.url).pathname === "/rest/v1/profiles") {
        return readProfile(providerRequest);
      }
      return Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "authenticated",
        email: "booker@example.test",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-01-01T00:00:00Z",
      });
    });
  vi.stubGlobal("fetch", authFetch);
  return authFetch;
}
