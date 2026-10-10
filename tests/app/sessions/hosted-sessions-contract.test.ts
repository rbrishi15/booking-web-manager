import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { hostedSessionActionSchema } from "@/app/sessions/hosted-sessions-contract";
import { toHostedSessionActions } from "@/app/sessions/session-actions";

const imports = (path: string) => [...readFileSync(path, "utf8").matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

describe("GET /api/sessions/hosted contract", () => {
  test("accepts every action the server advertises", () => {
    for (const action of toHostedSessionActions("session-1", [{ name: "set-visibility", visibility: "PUBLIC" }, { name: "preview-cancellation" }])) {
      expect(hostedSessionActionSchema.safeParse(action).success).toBe(true);
    }
  });

  test.each([
    ["set-visibility sent with GET", { name: "set-visibility", href: "/api/sessions/s/visibility", method: "GET", inputs: { visibility: "PUBLIC" } }],
    ["set-visibility without a target", { name: "set-visibility", href: "/api/sessions/s/visibility", method: "PATCH", inputs: {} }],
    ["preview-cancellation sent with PATCH", { name: "preview-cancellation", href: "/api/sessions/s/cancellation-preview", method: "PATCH", inputs: {} }],
    ["preview-cancellation with inputs", { name: "preview-cancellation", href: "/api/sessions/s/cancellation-preview", method: "GET", inputs: { visibility: "PUBLIC" } }],
    ["an unknown action", { name: "delete-session", href: "/api/sessions/s", method: "DELETE", inputs: {} }],
  ])("rejects %s", (_name, action) => {
    expect(hostedSessionActionSchema.safeParse(action).success).toBe(false);
  });

  test("the browser loads only the shared contract, never server code", () => {
    expect(imports("app/sessions/hosted-sessions-contract.ts")).toEqual(["zod"]);
    expect(imports("app/sessions/hosted-sessions-transport.ts")).toEqual(["zod", "./hosted-sessions-contract"]);
  });
});
