import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { logIn } from "@/app/(auth)/login/actions";
import { HOME_PATH, isAuthPage, isPublicPath, safeRedirectPath } from "@/app/(auth)/redirect-path";
import { loginSchema } from "@/app/(auth)/schemas";
import { createClient } from "@/lib/supabase/server";
import { middleware } from "@/middleware";
import {
  activeProfile,
  failedProfileLookup,
  fakeSupabase,
  formDataOf,
  inactiveProfile,
  missingProfile,
} from "./support/fake-supabase-auth";

// The login action and middleware talk to Supabase and Next.js; both are replaced with test doubles.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { RedirectCalled } = await import("./support/fake-supabase-auth");
  return {
    redirect: (path: string) => {
      throw new RedirectCalled(path);
    },
  };
});

const MARCUS = { id: "marcus" };
const signedIn = { data: { user: MARCUS, session: {} }, error: null };
const wrongPassword = { data: { user: null, session: null }, error: { code: "invalid_credentials", message: "x" } };
const credentials = { email: "marcus@example.com", password: "password123" };

// Owner: Joseph (Jolingoes) — /app/(auth)
describe("UC1-02 Authenticate User", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(createServerClient).mockReset();
  });

  describe("log in (server action)", () => {
    test("logs in with valid credentials", async () => {
      // Arrange
      const supabase = fakeSupabase({ signIn: signedIn, profile: activeProfile });
      vi.mocked(createClient).mockResolvedValue(supabase as never);

      // Act & Assert
      await expect(logIn({ status: "idle" }, formDataOf(credentials))).rejects.toMatchObject({ path: HOME_PATH });
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith(credentials);
      expect(supabase.profileEq).toHaveBeenCalledWith("user_id", "marcus");
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    test("returns to the page the user was heading to", async () => {
      // Arrange
      const supabase = fakeSupabase({ signIn: signedIn, profile: activeProfile });
      vi.mocked(createClient).mockResolvedValue(supabase as never);
      const form = formDataOf({ ...credentials, next: "/groups/join/abc123" });

      // Act & Assert
      await expect(logIn({ status: "idle" }, form)).rejects.toMatchObject({ path: "/groups/join/abc123" });
    });

    test("rejects invalid credentials without revealing which field was wrong", async () => {
      // Arrange
      const supabase = fakeSupabase({ signIn: wrongPassword });
      vi.mocked(createClient).mockResolvedValue(supabase as never);

      // Act
      const result = await logIn({ status: "idle" }, formDataOf(credentials));

      // Assert
      expect(result).toEqual({ status: "error", message: "Invalid email or password." });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    test("rejects a deleted (INACTIVE) account and signs it out", async () => {
      // Arrange
      const supabase = fakeSupabase({ signIn: signedIn, profile: inactiveProfile });
      vi.mocked(createClient).mockResolvedValue(supabase as never);

      // Act
      const result = await logIn({ status: "idle" }, formDataOf(credentials));

      // Assert
      expect(result).toEqual({ status: "error", message: "This account is no longer active." });
      expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    });

    test("rejects a login with no profile row and signs it out", async () => {
      // Arrange
      const supabase = fakeSupabase({ signIn: signedIn, profile: missingProfile });
      vi.mocked(createClient).mockResolvedValue(supabase as never);
      vi.spyOn(console, "error").mockImplementation(() => {});

      // Act
      const result = await logIn({ status: "idle" }, formDataOf(credentials));

      // Assert
      expect(result).toEqual({ status: "error", message: "We couldn't verify your account. Please try again." });
      expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    });

    test("rejects the login when the account status can't be checked", async () => {
      // Arrange
      const supabase = fakeSupabase({ signIn: signedIn, profile: failedProfileLookup });
      vi.mocked(createClient).mockResolvedValue(supabase as never);
      vi.spyOn(console, "error").mockImplementation(() => {});

      // Act
      const result = await logIn({ status: "idle" }, formDataOf(credentials));

      // Assert
      expect(result).toEqual({ status: "error", message: "We couldn't verify your account. Please try again." });
      expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    });
  });

  describe("establishes a session that subsequent requests can use (middleware)", () => {
    test("lets an email confirmation return reach the callback before a session exists", async () => {
      vi.mocked(createServerClient).mockReturnValue(fakeSupabase({ user: null }) as never);

      const response = await middleware(new NextRequest("https://booking-web-manager.vercel.app/auth/callback?code=confirmation-code"));

      expect(response.headers.get("location")).toBeNull();
    });

    test("lets a later request with a valid login cookie through", async () => {
      // Arrange
      const supabase = fakeSupabase({ user: MARCUS, profile: activeProfile });
      vi.mocked(createServerClient).mockReturnValue(supabase as never);

      // Act
      const response = await middleware(new NextRequest("http://localhost/profile"));

      // Assert
      expect(response.headers.get("location")).toBeNull();
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    test("sends a request without a valid login to /login, remembering the page", async () => {
      // Arrange
      vi.mocked(createServerClient).mockReturnValue(fakeSupabase({ user: null }) as never);

      // Act
      const response = await middleware(new NextRequest("http://localhost/groups?tab=mine"));

      // Assert
      expect(response.headers.get("location")).toBe("http://localhost/login?next=%2Fgroups%3Ftab%3Dmine");
    });

    test("signs out a deleted (INACTIVE) account on its next request", async () => {
      // Arrange
      const supabase = fakeSupabase({ user: MARCUS, profile: inactiveProfile });
      vi.mocked(createServerClient).mockReturnValue(supabase as never);

      // Act
      const response = await middleware(new NextRequest("http://localhost/profile"));

      // Assert
      expect(response.headers.get("location")).toBe("http://localhost/login");
      expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    });

    test("signs out a login with no profile row", async () => {
      // Arrange
      const supabase = fakeSupabase({ user: MARCUS, profile: missingProfile });
      vi.mocked(createServerClient).mockReturnValue(supabase as never);

      // Act
      const response = await middleware(new NextRequest("http://localhost/profile"));

      // Assert
      expect(response.headers.get("location")).toBe("http://localhost/login");
      expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    });

    test("signs out a login whose account status can't be checked", async () => {
      // Arrange
      const supabase = fakeSupabase({ user: MARCUS, profile: failedProfileLookup });
      vi.mocked(createServerClient).mockReturnValue(supabase as never);

      // Act
      const response = await middleware(new NextRequest("http://localhost/profile"));

      // Assert
      expect(response.headers.get("location")).toBe("http://localhost/login");
      expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    });

    test("keeps a logged-in user off the login page", async () => {
      // Arrange
      vi.mocked(createServerClient).mockReturnValue(fakeSupabase({ user: MARCUS, profile: activeProfile }) as never);

      // Act
      const response = await middleware(new NextRequest("http://localhost/login"));

      // Assert
      expect(response.headers.get("location")).toBe(`http://localhost${HOME_PATH}`);
    });
  });

  test("rejects an empty password before contacting Supabase", () => {
    // Arrange
    const input = { email: "marcus@example.com", password: "" };

    // Act
    const result = loginSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.password).toEqual(["Enter your password"]);
  });

  test("accepts a valid email and password", () => {
    // Arrange
    const input = { email: "marcus@example.com", password: "anything" };

    // Act
    const result = loginSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  describe("redirect after log-in", () => {
    test("uses Home as the post-login destination", () => {
      expect(HOME_PATH).toBe("/");
    });

    test.each([
      ["/profile", "/profile"],
      ["/groups/join/abc123", "/groups/join/abc123"],
      ["/login-help", "/login-help"],
    ] as const)("returns to %s", (next, expected) => {
      // Act
      const result = safeRedirectPath(next);

      // Assert
      expect(result).toBe(expected);
    });

    test.each([
      [undefined],
      [""],
      ["https://evil.example"],
      ["//evil.example"],
      ["/\\evil.example"],
      ["/\t/evil.example"],
      ["/\n/evil.example"],
      ["/login"],
      ["/login?next=/profile"],
      ["/register"],
    ] as const)("sends %j to Home instead", (next) => {
      // Act
      const result = safeRedirectPath(next);

      // Assert
      expect(result).toBe(HOME_PATH);
    });
  });

  describe("which pages need a login", () => {
    test.each(["/", "/login", "/register"])("%s is open to logged-out visitors", (path) => {
      // Act
      const result = isPublicPath(path);

      // Assert
      expect(result).toBe(true);
    });

    test.each(["/profile", "/groups", "/discover", "/wallet", "/groups/join/abc123"])(
      "%s requires a login",
      (path) => {
        // Act
        const result = isPublicPath(path);

        // Assert
        expect(result).toBe(false);
      },
    );

    test("logged-in users are kept off the login and register pages only", () => {
      // Act + Assert
      expect(isAuthPage("/login")).toBe(true);
      expect(isAuthPage("/register")).toBe(true);
      expect(isAuthPage("/")).toBe(false);
    });
  });
});
