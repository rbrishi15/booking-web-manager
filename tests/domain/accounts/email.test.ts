import { Email } from "@/domain";
import { describe, expect, test } from "vitest";

describe("Email", () => {
  test.each([
    "owner@example.com",
    "Owner+bookings@Example.COM",
    "owner@localhost",
  ])("preserves the exact address %s", (value) => {
    expect(new Email(value).toString()).toBe(value);
  });

  test.each([
    "",
    " ",
    "owner.example.com",
    "@example.com",
    "owner@",
    "owner@@example.com",
    "owner@example@com",
    " owner@example.com",
    "owner@example.com ",
    "own er@example.com",
    "owner@exam ple.com",
    "owner\t@example.com",
    "owner@example.com\n",
    "owner@example.com\r\n",
    "owner@example.com\u2028",
    "owner@\u00a0example.com",
  ])("rejects invalid address %j", (value) => {
    expect(() => new Email(value)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("compares addresses by exact text rather than object identity", () => {
    const email = new Email("Owner@example.com");

    expect(email.equals(new Email("Owner@example.com"))).toBe(true);
    expect(email.equals(new Email("owner@example.com"))).toBe(false);
    expect(email.equals(new Email("Owner@EXAMPLE.COM"))).toBe(false);
    expect(email.equals(new Email("other@example.com"))).toBe(false);
  });

  test("cannot be changed through its public surface", () => {
    const email = new Email("owner@example.com");

    expect(Object.isFrozen(email)).toBe(true);
    expect(Reflect.set(email, "value", "other@example.com")).toBe(false);
    expect(Reflect.set(email, "toString", () => "other@example.com")).toBe(false);
    expect(email.toString()).toBe("owner@example.com");
  });
});
