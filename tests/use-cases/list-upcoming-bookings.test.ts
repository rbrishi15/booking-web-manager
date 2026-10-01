import { expect, test, vi } from "vitest";
import {
  ListUpcomingBookings,
  type UpcomingBookingsReader,
} from "@/use-cases/sessions/ListUpcomingBookings";

test("scopes the bounded personal booking read to the verified identity and current clock", async () => {
  const now = new Date("2040-01-01T00:00:00Z");
  const userId = "10000000-0000-4000-8000-000000000001";
  const list = vi.fn<UpcomingBookingsReader["list"]>().mockResolvedValue([]);
  const bookings = new ListUpcomingBookings({ reader: { list }, clock: { now: () => now } });

  expect(await bookings.list(userId)).toEqual([]);
  expect(list).toHaveBeenCalledExactlyOnceWith({ userId, now, limit: 20 });
});

test("does not disguise a failed personal read as having no bookings", async () => {
  const failure = new Error("Database unavailable");
  const bookings = new ListUpcomingBookings({
    reader: { list: async () => { throw failure; } },
    clock: { now: () => new Date() },
  });

  await expect(bookings.list("10000000-0000-4000-8000-000000000001")).rejects.toBe(failure);
});
