import { describe, expect, test } from "vitest";
import { readPushSettings } from "@/app/commit/push-environment";

const publicKey = "B" + "a".repeat(86);
const privateKey = "c".repeat(43);
const valid = {
  VAPID_SUBJECT: "mailto:team@example.com",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey,
  VAPID_PRIVATE_KEY: privateKey,
};

describe("readPushSettings", () => {
  test("readPushSettings_WhenAllSet_ReturnsVapidDetails", () => {
    expect(readPushSettings(valid)).toEqual({
      subject: "mailto:team@example.com",
      publicKey,
      privateKey,
    });
  });

  test.each([
    ["no subject", { ...valid, VAPID_SUBJECT: undefined }],
    ["a subject that is not mailto or https", { ...valid, VAPID_SUBJECT: "team@example.com" }],
    ["no private key", { ...valid, VAPID_PRIVATE_KEY: "" }],
    ["a malformed public key", { ...valid, NEXT_PUBLIC_VAPID_PUBLIC_KEY: "not a key" }],
  ])("readPushSettings_WithEmpty %s_ReturnsUndefined", (_name, environment) => {
    expect(readPushSettings(environment)).toBeUndefined();
  });
});
