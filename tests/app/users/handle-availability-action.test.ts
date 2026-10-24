import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkUserHandleAvailability } from "@/app/users/handle-availability-action";
import { UserHandlesUnavailableError } from "@/app/users/user-handle-dependencies";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn(), availability: vi.fn() }));
vi.mock("@/app/users/user-handle-server-dependencies", () => ({ getUserHandleDependencies: mocks.dependencies }));

// Owner: Joseph (Jolingoes) — /app/users (UC1-01, UC1-03, ADR-0021)
describe("checkUserHandleAvailability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.dependencies.mockResolvedValue({ checkUserHandle: { availability: mocks.availability } });
  });

  test("passes the typed ID to the availability check and returns its answer", async () => {
    // Arrange
    mocks.availability.mockResolvedValue("TAKEN");

    // Act
    const result = await checkUserHandleAvailability("@Marcus_Lim");

    // Assert
    expect(result).toBe("TAKEN");
    expect(mocks.availability).toHaveBeenCalledExactlyOnceWith("@Marcus_Lim");
  });

  test.each([42, null, "x".repeat(65)])("treats %j as an invalid ID without checking", async (input) => {
    // Act
    const result = await checkUserHandleAvailability(input);

    // Assert
    expect(result).toBe("INVALID");
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });

  test("answers UNKNOWN quietly when the server has no database settings", async () => {
    // Arrange
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.availability.mockRejectedValue(new UserHandlesUnavailableError());

    // Act
    const result = await checkUserHandleAvailability("marcus_lim");

    // Assert
    expect(result).toBe("UNKNOWN");
    expect(log).not.toHaveBeenCalled();
  });

  test("answers UNKNOWN and logs when the check fails", async () => {
    // Arrange
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.availability.mockRejectedValue(new Error("connection refused"));

    // Act
    const result = await checkUserHandleAvailability("marcus_lim");

    // Assert
    expect(result).toBe("UNKNOWN");
    expect(log).toHaveBeenCalledOnce();
  });
});
