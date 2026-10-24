import { describe, expect, test } from "vitest";
import { UserHandle } from "@/domain/accounts/user-handle";

describe("User handle rules", () => {
  test("parse_WhenHandleIsLowerCase_KeepsItAndShowsItWithAt", () => {
    const handle = UserHandle.parse("marcus_lim");

    expect(handle.toString()).toBe("marcus_lim");
    expect(handle.toDisplay()).toBe("@marcus_lim");
  });

  test("parse_WhenTypedWithAtSpacesAndCapitals_StoresLowerCaseWithoutAt", () => {
    const handle = UserHandle.parse("  @Marcus_Lim ");

    expect(handle.toString()).toBe("marcus_lim");
  });

  test("parse_WhenHandleHasFiveCharacters_AcceptsTheShortestHandle", () => {
    const handle = UserHandle.parse("abc12");

    expect(handle.toString()).toBe("abc12");
  });

  test("parse_WhenHandleHasThirtyTwoCharacters_AcceptsTheLongestHandle", () => {
    const longest = "a".repeat(32);

    const handle = UserHandle.parse(longest);

    expect(handle.toString()).toBe(longest);
  });

  test("parse_WhenHandleHasFourCharacters_RejectsIt", () => {
    expect(() => UserHandle.parse("abcd")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleHasThirtyThreeCharacters_RejectsIt", () => {
    expect(() => UserHandle.parse("a".repeat(33))).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleStartsWithDigit_RejectsIt", () => {
    expect(() => UserHandle.parse("9marcus")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleStartsWithUnderscore_RejectsIt", () => {
    expect(() => UserHandle.parse("_marcus")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleEndsWithUnderscore_RejectsIt", () => {
    expect(() => UserHandle.parse("marcus_")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleRepeatsUnderscore_RejectsIt", () => {
    expect(() => UserHandle.parse("marcus__lim")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleHasDot_RejectsIt", () => {
    expect(() => UserHandle.parse("marcus.lim")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleHasInnerSpace_RejectsIt", () => {
    expect(() => UserHandle.parse("marcus lim")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenHandleHasNonAsciiLetter_RejectsIt", () => {
    expect(() => UserHandle.parse("marcüs_lim")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("parse_WhenOnlyAtIsTyped_RejectsIt", () => {
    expect(() => UserHandle.parse("@")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("equals_WhenHandlesDifferOnlyInCase_TreatsThemAsTheSameHandle", () => {
    const typed = UserHandle.parse("Marcus_Lim");
    const stored = UserHandle.parse("marcus_lim");

    expect(typed.equals(stored)).toBe(true);
  });

  test("equals_WhenHandlesDiffer_TreatsThemAsDifferent", () => {
    const first = UserHandle.parse("marcus_lim");
    const second = UserHandle.parse("marcus_tan");

    expect(first.equals(second)).toBe(false);
  });
});
