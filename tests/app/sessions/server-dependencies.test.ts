import type { SessionApiDependencies } from "@/app/sessions/dependencies";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const configuration = vi.hoisted(() => ({
  createSessionDependencies: vi.fn<() => SessionApiDependencies>(),
}));

vi.mock("@/use-case-config/sessions", () => configuration);

beforeEach(() => {
  vi.resetModules();
  configuration.createSessionDependencies.mockReset();
  configuration.createSessionDependencies.mockImplementation(assembledDependencies);
  configureServerEnvironment();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session server dependencies", () => {
  test("concurrent first callers receive the same assembled dependencies", async () => {
    // Arrange
    const { getSessionDependencies } = await import(
      "@/app/sessions/server-dependencies"
    );

    // Act
    const [first, concurrent] = await Promise.all([
      getSessionDependencies(),
      getSessionDependencies(),
    ]);

    // Assert
    expect(concurrent).toBe(first);
  });

  test("warm callers reuse dependencies without reading changed settings", async () => {
    // Arrange
    const { getSessionDependencies } = await import(
      "@/app/sessions/server-dependencies"
    );
    const first = await getSessionDependencies();
    vi.stubEnv("DATABASE_URL", "invalid-after-initialization");

    // Act
    const subsequent = await getSessionDependencies();

    // Assert
    expect(subsequent).toBe(first);
  });

  test("concurrent callers share an invalid-settings failure and can retry corrected settings", async () => {
    // Arrange
    vi.stubEnv("DATABASE_URL", "invalid-before-initialization");
    const { getSessionDependencies } = await import(
      "@/app/sessions/server-dependencies"
    );

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
    expect(first.reason).toMatchObject({ name: "ZodError" });
    expect(concurrent.reason).toBe(first.reason);

    // Act
    configureServerEnvironment();
    const recovered = await getSessionDependencies();

    // Assert
    expect(await getSessionDependencies()).toBe(recovered);
  });

  test("concurrent callers share a synchronous assembly failure and can retry setup", async () => {
    // Arrange
    configuration.createSessionDependencies.mockImplementation(() => {
      throw new Error("assembly-failure");
    });
    const { getSessionDependencies } = await import(
      "@/app/sessions/server-dependencies"
    );

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

    // Act
    configuration.createSessionDependencies.mockImplementation(assembledDependencies);
    const recovered = await getSessionDependencies();

    // Assert
    expect(await getSessionDependencies()).toBe(recovered);
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

function configureServerEnvironment() {
  vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:54322/postgres");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
}
