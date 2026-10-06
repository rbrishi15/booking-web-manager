import { describe, expect, test } from "vitest";
import { getCreateSessionAction, getSessionAccountActions, getVerifyEmailAction, toHostedSessionActions } from "@/app/sessions/session-actions";

const account = { accountStatus: "ACTIVE" as const, email: "player@example.com", emailVerified: true };

describe("session action descriptors", () => {
  test("offers creation only to an active account with a verified email", () => {
    expect(getCreateSessionAction(account)).toEqual({ name: "create-session", href: "/sessions/create", method: "GET", inputs: {} });
    expect(getCreateSessionAction({ ...account, emailVerified: false })).toBeUndefined();
    expect(getCreateSessionAction({ ...account, email: null })).toBeUndefined();
    expect(getCreateSessionAction({ ...account, accountStatus: "INACTIVE" })).toBeUndefined();
  });

  test("advertises email recovery for a signed-in unverified or missing-email account", () => {
    const verify = { name: "verify-email", href: "/profile/email", method: "GET", inputs: {} };
    expect(getVerifyEmailAction({ ...account, emailVerified: false })).toEqual(verify);
    expect(getVerifyEmailAction({ ...account, email: null })).toEqual(verify);
    expect(getVerifyEmailAction(account)).toBeUndefined();
    expect(getSessionAccountActions({ ...account, accountStatus: "INACTIVE" })).toEqual([]);
  });

  test("binds actual session targets and state-selected inputs without advertising join", () => {
    expect(toHostedSessionActions("session-id", [{ name: "set-visibility", visibility: "PRIVATE" }, { name: "preview-cancellation" }])).toEqual([
      { name: "set-visibility", href: "/api/sessions/session-id/visibility", method: "PATCH", inputs: { visibility: "PRIVATE" } },
      { name: "preview-cancellation", href: "/api/sessions/session-id/cancellation-preview", method: "GET", inputs: {} },
    ]);
    expect(toHostedSessionActions("session-id", [])).toEqual([]);
  });
});
