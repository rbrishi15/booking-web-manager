import type { SessionApiDependencies } from "@/app/sessions/dependencies";
import { beforeEach, describe, expect, test, vi } from "vitest";

const configuration = vi.hoisted(() => ({
  createSessionDependencies: vi.fn<() => SessionApiDependencies>(),
}));

vi.mock("@/use-case-config/sessions", () => configuration);

beforeEach(() => {
  vi.resetModules();
  configuration.createSessionDependencies.mockReset();
  configuration.createSessionDependencies.mockImplementation(assembledDependencies);
});

describe("session server dependencies", () => {
  test("concurrent first callers receive the same assembled dependencies", async () => {
    // Arrange
    const { getSessionDependencies } = await import("@/app/sessions/server-dependencies");

    // Act
    const [first, concurrent] = await Promise.all([
      getSessionDependencies(),
      getSessionDependencies(),
    ]);

    // Assert
    expect(concurrent).toBe(first);
    expect(configuration.createSessionDependencies).toHaveBeenCalledOnce();
  });

  test("warm callers reuse successfully assembled dependencies", async () => {
    // Arrange
    const { getSessionDependencies } = await import("@/app/sessions/server-dependencies");
    const first = await getSessionDependencies();

    // Act
    const subsequent = await getSessionDependencies();

    // Assert
    expect(subsequent).toBe(first);
    expect(configuration.createSessionDependencies).toHaveBeenCalledOnce();
  });

  test("concurrent callers share an assembly failure and can retry setup", async () => {
    // Arrange
    configuration.createSessionDependencies.mockImplementation(() => {
      throw new Error("assembly-failure");
    });
    const { getSessionDependencies } = await import("@/app/sessions/server-dependencies");

    // Act
    const [first, concurrent] = await Promise.allSettled([
      getSessionDependencies(),
      getSessionDependencies(),
    ]);

    // Assert
    expect(first.status).toBe("rejected");
    expect(concurrent.status).toBe("rejected");
    if (first.status !== "rejected" || concurrent.status !== "rejected") {
      throw new Error("Both callers must observe the initialization failure");
    }
    expect(first.reason).toMatchObject({ message: "assembly-failure" });
    expect(concurrent.reason).toBe(first.reason);
    expect(configuration.createSessionDependencies).toHaveBeenCalledOnce();

    // Act
    configuration.createSessionDependencies.mockImplementation(assembledDependencies);
    const recovered = await getSessionDependencies();

    // Assert
    expect(await getSessionDependencies()).toBe(recovered);
    expect(configuration.createSessionDependencies).toHaveBeenCalledTimes(2);
  });
});

function assembledDependencies(): SessionApiDependencies {
  return {
    authenticate: async () => null,
    createForSubmission: () => {
      throw new Error("This scenario does not submit a session");
    },
  };
}
