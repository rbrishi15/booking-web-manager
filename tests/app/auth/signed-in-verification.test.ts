import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { beforeEach, expect, test, vi } from "vitest";
import { addAccountEmail, refreshEmailVerification, resendOwnEmailConfirmation } from "@/app/profile/email/actions";
import { createClient } from "@/lib/supabase/server";
import { formDataOf } from "../../use-cases/support/fake-supabase-auth";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const user = { id: "viewer", email: "viewer@example.com" };
const getUser = vi.fn();
const resend = vi.fn();
const updateUser = vi.fn();
const maybeSingle = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user }, error: null });
  resend.mockResolvedValue({ error: null });
  updateUser.mockResolvedValue({ data: { user }, error: null });
  maybeSingle.mockResolvedValue({ data: { account_status: "ACTIVE" }, error: null });
  vi.mocked(headers).mockResolvedValue(new Headers({ origin: "https://booking-web-manager.vercel.app" }) as never);
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser, resend, updateUser }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) } as never);
});

test("resends confirmation to the signed-in account instead of the submitted target", async () => {
  const result = await resendOwnEmailConfirmation({ status: "idle" }, formDataOf({ email: "other@example.com" }));
  expect(result.status).toBe("sent");
  expect(resend).toHaveBeenCalledWith({ type: "signup", email: "viewer@example.com", options: { emailRedirectTo: "https://booking-web-manager.vercel.app/auth/callback" } });
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});

test("resends a pending email addition without requiring a current email address", async () => {
  getUser.mockResolvedValue({ data: { user: { id: "viewer", email: "", new_email: "pending@example.com" } }, error: null });
  expect((await resendOwnEmailConfirmation({ status: "idle" }, formDataOf({ email: "other@example.com" }))).status).toBe("sent");
  expect(updateUser).toHaveBeenCalledWith({ email: "pending@example.com" }, { emailRedirectTo: "https://booking-web-manager.vercel.app/auth/callback" });
  expect(resend).not.toHaveBeenCalled();
});

test("adds an email to the existing account and leaves access waiting for confirmation", async () => {
  getUser.mockResolvedValue({ data: { user: { id: "viewer" } }, error: null });
  const result = await addAccountEmail({ status: "idle" }, formDataOf({ email: " Pending@Example.com " }));
  expect(result.status).toBe("sent");
  expect(updateUser).toHaveBeenCalledWith({ email: "pending@example.com" }, { emailRedirectTo: "https://booking-web-manager.vercel.app/auth/callback" });
});

test("freshly checks verification after the email link is opened in another tab", async () => {
  expect((await refreshEmailVerification({ status: "idle" }, new FormData())).status).toBe("error");
  getUser.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: "2026-10-03T00:00:00Z" } }, error: null });
  expect((await refreshEmailVerification({ status: "idle" }, new FormData())).status).toBe("verified");
  expect(getUser).toHaveBeenCalledTimes(2);
  expect(resend).not.toHaveBeenCalled();
});

test.each(["INACTIVE", null])("refuses confirmation requests for a non-active profile %s", async (status) => {
  maybeSingle.mockResolvedValue({ data: status === null ? null : { account_status: status }, error: null });
  expect((await resendOwnEmailConfirmation({ status: "idle" }, new FormData())).status).toBe("error");
  expect(resend).not.toHaveBeenCalled();
  expect(updateUser).not.toHaveBeenCalled();
});

test.each([{ status: 429 }, { code: "over_email_send_rate_limit" }, { code: "over_request_rate_limit" }])("shows usable cooldown guidance for %j", async (error) => {
  resend.mockResolvedValue({ error });
  expect(await resendOwnEmailConfirmation({ status: "idle" }, new FormData())).toMatchObject({ status: "error", message: "Please wait a minute before requesting another confirmation email." });
});

test("rejects a signed-out request and an invalid email before changing the account", async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await resendOwnEmailConfirmation({ status: "idle" }, new FormData())).status).toBe("error");
  expect((await addAccountEmail({ status: "idle" }, formDataOf({ email: "invalid" }))).status).toBe("error");
  expect(updateUser).not.toHaveBeenCalled();
});

test("does not send again for a verified current email", async () => {
  getUser.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: "2026-10-03T00:00:00Z" } }, error: null });
  expect((await resendOwnEmailConfirmation({ status: "idle" }, new FormData())).status).toBe("verified");
  expect(resend).not.toHaveBeenCalled();
});

test("handles provider failures without exposing private details", async () => {
  resend.mockRejectedValue(new Error("private service detail"));
  expect(await resendOwnEmailConfirmation({ status: "idle" }, new FormData())).toEqual({ status: "error", message: "We couldn't send a confirmation email. Please try again." });
});
