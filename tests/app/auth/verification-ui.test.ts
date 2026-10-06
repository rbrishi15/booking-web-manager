import { createElement, useActionState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { logIn } from "@/app/(auth)/login/actions";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { registerUser } from "@/app/(auth)/register/actions";
import { RegisterForm } from "@/app/(auth)/register/register-form";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: vi.fn(),
}));
vi.mock("@/app/(auth)/login/actions", () => ({ logIn: vi.fn() }));
vi.mock("@/app/(auth)/register/actions", () => ({ registerUser: vi.fn() }));
vi.mock("@/app/(auth)/resend-confirmation", () => ({ resendConfirmation: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe("pending verification UI", () => {
  test("replaces the completed registration form with email recovery and a login path", () => {
    vi.mocked(useActionState).mockImplementation((action) => [
      action === registerUser ? { status: "check-email", email: "marcus@example.com" } : { status: "idle" },
      vi.fn(), false,
    ]);

    const html = renderToStaticMarkup(createElement(RegisterForm));

    expect(html).toContain("marcus@example.com");
    expect(html).toContain("You are not logged in yet");
    expect(html).toContain("Resend confirmation email");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('name="password"');
  });

  test("gives an unverified login a separate resend form while retaining the login destination", () => {
    vi.mocked(useActionState).mockImplementation((action) => [
      action === logIn ? { status: "check-email", email: "marcus@example.com" } : { status: "idle" },
      vi.fn(), false,
    ]);

    const html = renderToStaticMarkup(createElement(LoginForm, { next: "/profile" }));

    expect(html).toContain("Resend confirmation email");
    expect(html).toContain('name="next" value="/profile"');
    expect(html).toContain('name="password"');
    expect(html.match(/<form\b/g)).toHaveLength(2);
    expect(html.indexOf("</form>")).toBeLessThan(html.lastIndexOf("<form"));
  });
});
