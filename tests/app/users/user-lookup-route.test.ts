import { beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "@/app/api/users/by-handle/[handle]/route";
import { UserHandlesUnavailableError } from "@/app/users/user-handle-dependencies";
import { DomainError } from "@/domain";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn(), authenticate: vi.fn(), forHandle: vi.fn() }));
vi.mock("@/app/users/user-handle-server-dependencies", () => ({ getUserHandleDependencies: mocks.dependencies }));

const VIEWER = "11111111-1111-4111-8111-111111111111";
const MARCUS = { userId: "6f1c2a7e-4b8d-4c1e-9a3f-2d5b7c9e1f03", handle: "marcus_lim", displayName: "Marcus Lim" };

function lookup(handle: string) {
  return GET(new Request(`https://app.test/api/users/by-handle/${encodeURIComponent(handle)}`, {
    headers: { authorization: "Bearer viewer-token" },
  }), { params: Promise.resolve({ handle }) });
}

// Owner: Joseph (Jolingoes) — /app/api/users (ADR-0021)
describe("GET /api/users/by-handle/{handle}", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue(VIEWER);
    mocks.dependencies.mockResolvedValue({ authenticate: mocks.authenticate, findUserByHandle: { forHandle: mocks.forHandle } });
  });

  test("returns the player's public summary without caching", async () => {
    // Arrange
    mocks.forHandle.mockResolvedValue(MARCUS);

    // Act
    const response = await lookup("@Marcus_Lim");

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ user: MARCUS });
    expect(mocks.forHandle).toHaveBeenCalledExactlyOnceWith("@Marcus_Lim");
  });

  test("answers 404 when no active player holds the ID", async () => {
    // Arrange
    mocks.forHandle.mockRejectedValue(new DomainError("NOT_FOUND", "No player has this user ID"));

    // Act
    const response = await lookup("nobody_here");

    // Assert
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "No player has this user ID" } });
  });

  test("answers 400 for a malformed ID", async () => {
    // Arrange
    mocks.forHandle.mockRejectedValue(new DomainError("INVALID_INPUT", "A user ID must have 5-32 letters"));

    // Act
    const response = await lookup("bad id");

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
  });

  test("refuses an overlong ID before looking anything up", async () => {
    // Act
    const response = await lookup("a".repeat(65));

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(mocks.forHandle).not.toHaveBeenCalled();
  });

  test("answers 503 when the server has no database settings", async () => {
    // Arrange
    mocks.forHandle.mockRejectedValue(new UserHandlesUnavailableError());

    // Act
    const response = await lookup("marcus_lim");

    // Assert
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "USER_IDS_UNAVAILABLE" } });
  });

  test("keeps infrastructure failures opaque", async () => {
    // Arrange
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.forHandle.mockRejectedValue(new Error("password authentication failed for user postgres"));

    // Act
    const response = await lookup("marcus_lim");

    // Assert
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
});
