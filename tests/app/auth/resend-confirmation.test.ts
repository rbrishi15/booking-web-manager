import { beforeEach, describe, expect, test, vi } from "vitest";
import { emailConfirmationRedirectTo } from "@/app/(auth)/email-confirmation-url";
import { resendConfirmation } from "@/app/(auth)/resend-confirmation";
import { createClient } from "@/lib/supabase/server";
import { formDataOf } from "../../use-cases/support/fake-supabase-auth";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/app/(auth)/email-confirmation-url", () => ({ emailConfirmationRedirectTo: vi.fn() }));

const resend = vi.fn();
const idle = { status: "idle" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(emailConfirmationRedirectTo).mockResolvedValue("https://booking-web-manager.vercel.app/auth/callback");
  vi.mocked(createClient).mockResolvedValue({ auth: { resend } } as never);
  resend.mockResolvedValue({ data: {}, error: null });
});

describe("UC1-01 resend email confirmation", () => {
  test("sends a normalized address a replacement link to the deployed callback", async () => {
    const result = await resendConfirmation(idle, formDataOf({ email: " Marcus@Example.com " }));

    expect(resend).toHaveBeenCalledExactlyOnceWith({
      type: "signup", email: "marcus@example.com",
      options: { emailRedirectTo: "https://booking-web-manager.vercel.app/auth/callback" },
    });
    expect(result.status).toBe("sent");
    expect(result.message).toContain("If this email has an account awaiting confirmation");
  });

  test("does not disclose a missing account", async () => {
    const success = await resendConfirmation(idle, formDataOf({ email: "marcus@example.com" }));
    resend.mockResolvedValue({ error: { code: "user_not_found", status: 404 } });

    expect(await resendConfirmation(idle, formDataOf({ email: "someone@example.com" }))).toEqual(success);
  });

  test.each([
    { code: "over_email_send_rate_limit", status: 429 },
    { code: "over_request_rate_limit", status: 429 },
  ])("gives a retry instruction for provider rate limits: $code", async (error) => {
    resend.mockResolvedValue({ error });

    expect(await resendConfirmation(idle, formDataOf({ email: "marcus@example.com" }))).toEqual({
      status: "error", message: "Please wait a minute before requesting another confirmation email.",
    });
  });

  test("rejects an invalid email before contacting the provider", async () => {
    expect((await resendConfirmation(idle, formDataOf({ email: "not-an-email" }))).status).toBe("error");
    expect(createClient).not.toHaveBeenCalled();
  });

  test("requires a valid page origin before sending a replacement link", async () => {
    vi.mocked(emailConfirmationRedirectTo).mockResolvedValue(null);

    expect((await resendConfirmation(idle, formDataOf({ email: "marcus@example.com" }))).message).toContain("Reload the page");
    expect(createClient).not.toHaveBeenCalled();
  });

  test("keeps unexpected provider failures in the form without exposing provider details", async () => {
    resend.mockResolvedValue({ error: { code: "unexpected_failure", message: "private provider details", status: 500 } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await resendConfirmation(idle, formDataOf({ email: "marcus@example.com" }))).toEqual({
      status: "error", message: "We couldn't send a confirmation email. Please try again.",
    });
  });

  test("keeps a failed network request recoverable", async () => {
    resend.mockRejectedValue(new Error("network connection failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await resendConfirmation(idle, formDataOf({ email: "marcus@example.com" }))).status).toBe("error");
  });
});
