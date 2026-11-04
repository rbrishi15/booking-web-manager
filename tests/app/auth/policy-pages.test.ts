import { createElement, useActionState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import PrivacyPage from "@/app/(auth)/privacy/page";
import { RegisterForm } from "@/app/(auth)/register/register-form";
import TermsPage from "@/app/(auth)/terms/page";

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: vi.fn(),
}));
vi.mock("@/app/(auth)/register/actions", () => ({ registerUser: vi.fn() }));
vi.mock("@/app/(auth)/resend-confirmation", () => ({ resendConfirmation: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

test("registration links to the terms and privacy policy it asks people to agree to", () => {
  vi.mocked(useActionState).mockReturnValue([{ status: "idle" }, vi.fn(), false]);

  const html = renderToStaticMarkup(createElement(RegisterForm));

  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/privacy"');
});

test("the terms state the money rules shown elsewhere in the app", () => {
  const html = renderToStaticMarkup(createElement(TermsPage));

  expect(html).toContain("<h1");
  expect(html).toContain("At least 30 hours before the start: your full share comes back to your wallet.");
  expect(html).toContain("Less than 30 hours before the start: invite one person or forfeit your share.");
  expect(html).toContain("72 hours after the");
  expect(html).toContain("Stripe test mode");
  expect(html).toContain("does not reserve venues");
  expect(html).toContain('href="/privacy"');
});

test("the privacy policy links to every account control it mentions", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  for (const href of ["/profile/email", "/profile/edit", "/profile", "/profile/delete"]) {
    expect(html).toContain(`href="${href}"`);
  }
  expect(html).toContain("never shown to other players");
  // The register and log-in actions receive the password and pass it to Supabase; it is never stored here.
  expect(html).toContain("we never store it ourselves");
  expect(html).not.toContain("we never see it");
  expect(html).toContain("kept without your name");
});
