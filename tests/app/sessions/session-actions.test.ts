import { describe, expect, test } from "vitest";
import { getCreateSessionAction, getSessionAccountActions, getAddEmailAction, toHostedSessionActions } from "@/app/sessions/session-actions";

const account = { accountStatus: "ACTIVE" as const, email: "player@example.com", emailVerified: true };

describe("session action descriptors", () => {
  test("offers creation to active accounts with an email, regardless of confirmation", () => {
    expect(getCreateSessionAction(account)).toEqual({ name: "create-session", href: "/sessions/create", method: "GET", inputs: {} });
    expect(getCreateSessionAction({ ...account, emailVerified: false })).toBeDefined();
    expect(getCreateSessionAction({ ...account, email: null })).toBeUndefined();
    expect(getCreateSessionAction({ ...account, accountStatus: "INACTIVE" })).toBeUndefined();
  });

  test("offers email setup only when the signed-in account lacks an email", () => {
    const add = { name: "add-email", href: "/profile/email", method: "GET", inputs: {} };
    expect(getAddEmailAction({ ...account, emailVerified: false })).toBeUndefined();
    expect(getAddEmailAction({ ...account, email: null })).toEqual(add);
    expect(getAddEmailAction(account)).toBeUndefined();
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
