import { describe, expect, test } from "vitest";
import { decimalCents, draftFromSubmission, emptySessionDraft, parseSgdCents, pendingStorageKey, singaporeTimestamp, submissionPayload, updateDraft, validateStep } from "@/app/sessions/create/model";

const complete = { ...emptySessionDraft, venueName: "Booked court", region: "West", cost: "60.00", price: "7.50",
  startDate: "2045-06-17", startTime: "23:00", endDate: "2045-06-18", endTime: "01:00" };
describe("Create-session drafts", () => {
  test.each([["0.01", 1], ["60", 6000], ["60.1", 6010], [" 60.01 ", 6001], ["90071992547409.91", Number.MAX_SAFE_INTEGER]])("parses %s directly into %s cents", (value, cents) => {
    expect(parseSgdCents(value)).toBe(cents);
    expect(decimalCents(cents)).toBe(value.trim().includes(".") ? value.trim().padEnd(value.trim().indexOf(".") + 3, "0") : `${value}.00`);
  });
  test.each(["", "-1", "1.001", "1e2", "Infinity", "90071992547409.92", "1,000", ".5"])("rejects invalid SGD input %s", (value) => expect(parseSgdCents(value)).toBeUndefined());
  test("uses Singapore time for overnight bookings and rejects calendar overflow", () => {
    expect(singaporeTimestamp("2045-06-17", "23:00")).toBe("2045-06-17T15:00:00.000Z");
    expect(singaporeTimestamp("2045-02-30", "07:00")).toBeUndefined();
    expect(singaporeTimestamp("2045-06-17", "24:00")).toBeUndefined();
    expect(validateStep(complete, 1)).toEqual({});
    expect(validateStep({ ...complete, endDate: complete.startDate }, 1)).toHaveProperty("dateTime");
  });
  test("resets customized price when capacity or cost changes", () => {
    expect(updateDraft({ ...complete, price: "12.00" }, { totalSlots: 2 })).toMatchObject({ price: "30.00" });
    expect(updateDraft({ ...complete, price: "12.00" }, { cost: "80.00" }).price).toBe("10.00");
    expect(updateDraft(complete, { venueName: "New court" }).price).toBe("7.50");
  });
  test("validates details, settings and cent-adjusted pricing", () => {
    expect(validateStep(emptySessionDraft, 1)).toHaveProperty("venueName");
    expect(validateStep({ ...complete, cost: "0.01" }, 1)).toHaveProperty("cost");
    expect(validateStep({ ...complete, totalSlots: 1 }, 2)).toHaveProperty("totalSlots");
    expect(validateStep({ ...complete, price: "15.01" }, 3)).toHaveProperty("price");
    expect(validateStep({ ...complete, price: "14.99" }, 3)).toEqual({});
  });
  test("retains chosen price and reliability scale when restoring a user-scoped pending payload", () => {
    const payload = submissionPayload({ ...complete, price: "12.01" }, "key");
    expect(payload.config).toMatchObject({ minimumReliability: 90, pricePerSlotCents: 1201 });
    expect(draftFromSubmission(payload)).toEqual({ ...complete, price: "12.01" });
    expect(pendingStorageKey("alice")).not.toBe(pendingStorageKey("bob"));
    expect(submissionPayload({ ...complete, reliability: "none" }, "key").config.minimumReliability).toBeUndefined();
  });
});
