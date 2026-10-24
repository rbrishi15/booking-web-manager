import { beforeEach, describe, expect, test, vi } from "vitest";
import { findPlayer } from "@/app/users/find-player-action";
import { UserHandlesUnavailableError } from "@/app/users/user-handle-dependencies";
import { DomainError } from "@/domain";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), forHandle: vi.fn(), reliability: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/app/users/user-handle-server-dependencies", () => ({
  getUserHandleDependencies: async () => ({ findUserByHandle: { forHandle: mocks.forHandle } }),
}));
vi.mock("@/app/profile/reliability", () => ({ loadReliabilityScore: mocks.reliability }));

const MARCUS = { userId: "6f1c2a7e-4b8d-4c1e-9a3f-2d5b7c9e1f03", handle: "marcus_lim", displayName: "Marcus Lim" };

function search(handle: string) {
  const form = new FormData();
  form.set("handle", handle);
  return findPlayer({ status: "idle" }, form);
}

// Owner: Joseph (Jolingoes) — /app/users (ADR-0021)
describe("findPlayer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "viewer" } } });
    mocks.forHandle.mockResolvedValue(MARCUS);
    mocks.reliability.mockResolvedValue(96);
  });

  test("shows the found player's name, user ID and reliability score, without their internal ID", async () => {
    // Act
    const result = await search("@Marcus_Lim");

    // Assert
    expect(result).toEqual({ status: "found", player: { handle: "marcus_lim", displayName: "Marcus Lim", reliabilityScore: 96 } });
    expect(mocks.forHandle).toHaveBeenCalledExactlyOnceWith("marcus_lim");
    expect(mocks.reliability).toHaveBeenCalledExactlyOnceWith(MARCUS.userId);
  });

  test("passes on an unavailable score as null", async () => {
    // Arrange
    mocks.reliability.mockResolvedValue(null);

    // Act
    const result = await search("marcus_lim");

    // Assert
    expect(result).toMatchObject({ status: "found", player: { reliabilityScore: null } });
  });

  test("says when nobody has the user ID", async () => {
    // Arrange
    mocks.forHandle.mockRejectedValue(new DomainError("NOT_FOUND", "No player has this user ID"));

    // Act
    const result = await search("nobody_here");

    // Assert
    expect(result).toEqual({ status: "not-found", handle: "nobody_here" });
  });

  test("explains a malformed ID before signing in or searching", async () => {
    // Act
    const result = await search("9lives");

    // Assert
    expect(result).toEqual({ status: "error", message: "Start with a letter" });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.forHandle).not.toHaveBeenCalled();
  });

  test("refuses a signed-out search", async () => {
    // Arrange
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    // Act
    const result = await search("marcus_lim");

    // Assert
    expect(result).toEqual({ status: "error", message: "Please log in again." });
    expect(mocks.forHandle).not.toHaveBeenCalled();
  });

  test("says search is unavailable when the server has no database settings", async () => {
    // Arrange
    mocks.forHandle.mockRejectedValue(new UserHandlesUnavailableError());

    // Act
    const result = await search("marcus_lim");

    // Assert
    expect(result).toEqual({ status: "error", message: "Player search isn't available right now." });
  });

  test("keeps unexpected failures generic and logs them", async () => {
    // Arrange
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.forHandle.mockRejectedValue(new Error("connection refused"));

    // Act
    const result = await search("marcus_lim");

    // Assert
    expect(result).toEqual({ status: "error", message: "We couldn't search right now. Please try again." });
    expect(log).toHaveBeenCalledOnce();
  });
});
