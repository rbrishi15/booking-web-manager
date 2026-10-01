import { beforeEach, describe, expect, test, vi } from "vitest";
import { HOME_PATH } from "@/app/(auth)/redirect-path";
import { registerUser } from "@/app/(auth)/register/actions";
import { passwordStrength } from "@/app/(auth)/register/password-strength";
import { registerSchema } from "@/app/(auth)/schemas";
import { createClient } from "@/lib/supabase/server";
import { fakeSupabase, formDataOf } from "./support/fake-supabase-auth";

// The server action talks to Supabase and Next.js; both are replaced with test doubles.
// The profile + S$0.00 wallet that the sign-up trigger creates is covered against real
// Postgres in UC1-01-provisioning.db.test.ts.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { RedirectCalled } = await import("./support/fake-supabase-auth");
  return {
    redirect: (path: string) => {
      throw new RedirectCalled(path);
    },
  };
});

// Owner: Joseph (Jolingoes) — /app/(auth)
describe("UC1-01 Register User", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  test("registers a new user with a unique email", async () => {
    // Arrange
    const supabase = fakeSupabase({
      signUp: { data: { user: { id: "marcus", identities: [{}] }, session: {} }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    // Act & Assert
    await expect(registerUser({ status: "idle" }, formDataOf(validRegistration()))).rejects.toMatchObject({
      path: HOME_PATH,
    });
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: "marcus@example.com",
      password: "password123",
      options: {
        data: { display_name: "Marcus Lim", preferred_sports: ["Tennis"], preferred_regions: ["West"] },
      },
    });
  });

  test("rejects registration with an email already in use", async () => {
    // Arrange
    const supabase = fakeSupabase({
      signUp: { data: { user: null, session: null }, error: { code: "user_already_exists", message: "exists" } },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    // Act
    const result = await registerUser({ status: "idle" }, formDataOf(validRegistration()));

    // Assert
    expect(result).toEqual({
      status: "error",
      message: "An account with this email already exists.",
      emailTaken: true,
    });
  });

  test("rejects an email already in use when Supabase hides it (no identities)", async () => {
    // Arrange: with email confirmation on, Supabase returns a user with no identities instead of an error.
    const supabase = fakeSupabase({
      signUp: { data: { user: { id: "existing", identities: [] }, session: null }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    // Act
    const result = await registerUser({ status: "idle" }, formDataOf(validRegistration()));

    // Assert
    expect(result.emailTaken).toBe(true);
  });

  test("asks the user to confirm their email when sign-up gives no session yet", async () => {
    // Arrange
    const supabase = fakeSupabase({
      signUp: { data: { user: { id: "marcus", identities: [{}] }, session: null }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    // Act
    const result = await registerUser({ status: "idle" }, formDataOf(validRegistration()));

    // Assert
    expect(result.status).toBe("check-email");
  });

  test("does not contact Supabase when the form is invalid", async () => {
    // Arrange
    const supabase = fakeSupabase();
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    // Act
    const result = await registerUser({ status: "idle" }, formDataOf(validRegistration({ email: "not-an-email" })));

    // Assert
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.email).toBeDefined();
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  describe("rejects invalid or weak credentials at the boundary (Zod)", () => {
    test("rejects an invalid email", () => {
      // Arrange
      const input = validRegistration({ email: "not-an-email" });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.email).toEqual(["Enter a valid email address"]);
    });

    test("rejects a password shorter than 8 characters", () => {
      // Arrange
      const input = validRegistration({ password: "short" });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.password).toEqual(["Use at least 8 characters"]);
    });

    test("rejects a blank name", () => {
      // Arrange
      const input = validRegistration({ displayName: "   " });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.displayName).toEqual(["Enter your name"]);
    });

    test("rejects a region that is not in the list", () => {
      // Arrange
      const input = validRegistration({ region: "Mars" });

      // Act
      const result = registerSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.region).toEqual(["Choose a region"]);
    });
  });

  test("accepts valid details and normalises the name and email", () => {
    // Arrange
    const input = validRegistration({ displayName: "  Marcus Lim  ", email: "  Marcus@Example.com " });

    // Act
    const result = registerSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data?.displayName).toBe("Marcus Lim");
    expect(result.data?.email).toBe("marcus@example.com");
  });

  describe("password strength hint", () => {
    test.each([
      ["", 0],
      ["short", 1],
      ["password", 1],
      ["password1", 2],
      ["Password1", 3],
      ["Password1!", 4],
    ] as const)("scores %j as %i bars", (password, expectedScore) => {
      // Act
      const result = passwordStrength(password);

      // Assert
      expect(result.score).toBe(expectedScore);
    });
  });
});

function validRegistration(overrides: Record<string, string> = {}) {
  return {
    displayName: "Marcus Lim",
    email: "marcus@example.com",
    password: "password123",
    region: "West",
    sport: "Tennis",
    ...overrides,
  };
}
