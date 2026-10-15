import { describe, expect, test } from "vitest";
import {
  completeEmail,
  editEmail,
  normalizeEmail,
  selectEmailEnding,
  type EmailInputValue,
} from "@/app/(auth)/_components/email-input-value";

const initial: EmailInputValue = { mode: "split", address: "", ending: ".com" };

describe("registration email ending", () => {
  test("submits an empty value until the user enters an address", () => {
    expect(completeEmail(initial)).toBe("");
  });

  test("adds the chosen ending to a partial address", () => {
    const value = selectEmailEnding(editEmail(initial, "player@example"), ".org");
    expect(completeEmail(value)).toBe("player@example.org");
  });

  test.each(["player@example.com", "player@example.co.uk", "player@school.edu.sg", "player@club.sport", "player@mail.example.com", "player@EXAMPLE.COM"])(
    "preserves a typed, pasted, or autofilled full address: %s",
    (address) => {
      const value = editEmail(initial, address);
      expect(completeEmail(value)).toBe(address);
      expect(completeEmail(normalizeEmail(value))).toBe(address);
    },
  );

  test("does not remove an ending while the user is still typing a longer domain", () => {
    let value: EmailInputValue = initial;
    for (const character of "player@example.com.au") {
      value = editEmail(value, `${value.address}${character}`);
    }
    expect(completeEmail(value)).toBe("player@example.com.au");
  });

  test("can split a simple complete address after editing finishes", () => {
    expect(normalizeEmail(editEmail(initial, "player@example.net"))).toEqual({
      mode: "split", address: "player@example", ending: ".net",
    });
  });

  test("switching to Other preserves the complete address for custom editing", () => {
    const custom = selectEmailEnding(editEmail(initial, "player@example"), "");
    expect(custom).toEqual({ mode: "full", address: "player@example.com" });
    expect(completeEmail(editEmail(custom, "player@example.dev"))).toBe("player@example.dev");
  });

  test("an explicit ending change preserves all earlier domain labels", () => {
    const value = selectEmailEnding(editEmail(initial, "player@mail.example.net"), ".org");
    expect(completeEmail(value)).toBe("player@mail.example.org");
  });

  test("keeps malformed full addresses intact for validation", () => {
    const address = "player@@example.com";
    expect(completeEmail(normalizeEmail(editEmail(initial, address)))).toBe(address);
  });
});
