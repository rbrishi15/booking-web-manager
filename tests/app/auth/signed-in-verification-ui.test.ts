import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SignedInVerificationPrompt } from "@/app/(auth)/_components/signed-in-verification-prompt";
import { EmailVerificationForm } from "@/app/profile/email/email-verification-form";

test("a signed-in account without an email sees an email setup prompt", () => {
  const html = renderToStaticMarkup(createElement(SignedInVerificationPrompt, { user: { accountStatus: "ACTIVE", email: null, pendingEmail: null, emailVerified: false } }));
  expect(html).toContain("You can keep browsing");
  expect(html).toContain('href="/profile/email"');
  expect(html).toContain("Add email");
  expect(html).not.toContain("not logged in");
});

test("an unconfirmed current email does not trigger a booking gate", () => {
  const html = renderToStaticMarkup(createElement(SignedInVerificationPrompt, { user: { accountStatus: "ACTIVE", email: "viewer@example.com", pendingEmail: null, emailVerified: false } }));
  expect(html).toBe("");
});

test("a missing-email account has an add-email form and can check verification without signing out", () => {
  const html = renderToStaticMarkup(createElement(EmailVerificationForm, { email: null, pendingEmail: null, emailVerified: false }));
  expect(html).toContain('name="email"');
  expect(html).toContain("Send confirmation link");
  expect(html).toContain("check again");
  expect(html).not.toContain("Resend confirmation email");
});

test("a pending addition offers resend and correction while keeping its target separate", () => {
  const html = renderToStaticMarkup(createElement(EmailVerificationForm, { email: null, pendingEmail: "pending@example.com", emailVerified: false }));
  expect(html).toContain("pending@example.com");
  expect(html).toContain("Resend confirmation email");
  expect(html).toContain("Update email");
});
