import type { DiscoveryPage } from "../contracts";
import type { DiscoveryFilters } from "../query";

export const emptyFilters: DiscoveryFilters = { sport: "", region: "", date: "", timeFrom: "", timeTo: "" };

export const examplePage: DiscoveryPage = {
  items: [
    { sessionId: "00000000-0000-4000-8000-000000000001", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: "2035-05-12T10:00:00.000Z", endAt: "2035-05-12T12:00:00.000Z", totalSlots: 6, bookingShareCents: 750 },
    { sessionId: "00000000-0000-4000-8000-000000000002", venueName: "Tampines Hub", sport: "Tennis", region: "East", startAt: "2035-05-13T01:00:00.000Z", endAt: "2035-05-13T03:00:00.000Z", totalSlots: 4, bookingShareCents: 1200 },
  ],
  nextCursor: null,
};
