import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";

export function registerVenueApi(registry: OpenAPIRegistry): void {
  const candidate = z.object({ venueName: z.string(), address: z.string(), postalCode: z.string(), latitude: z.number(), longitude: z.number(),
    region: z.enum(["Central", "East", "North", "North-East", "West"]).nullable() });
  registry.registerPath({
    method: "get", path: "/api/venues", operationId: "searchVenues", tags: ["Venues"], summary: "Search already-booked venues",
    description: "Requires an active Supabase bearer identity. OneMap credentials and tokens remain server-side. Coordinates are mapped to the five application regions using bundled URA boundaries; a null region requires manual entry. Lookup does not reserve a venue or open a database transaction. Missing configuration, upstream failures and empty results allow manual venue and region entry.",
    security: [{ bearerAuth: [] }], request: { query: z.object({ q: z.string().min(2).max(100), page: z.coerce.number().int().min(1).max(1000).optional() }) },
    responses: {
      200: { description: "Application-owned venue candidates and the next page, or null.", content: { "application/json": { schema: z.object({ items: z.array(candidate), nextPage: z.number().int().positive().nullable() }) } } },
      400: errorResponse("Invalid or repeated query parameters.", "INVALID_REQUEST", "Invalid venue query"),
      401: errorResponse("Missing or expired bearer identity.", "UNAUTHENTICATED", "Authentication is required"),
      403: errorResponse("Inactive account.", "INACTIVE_ACCOUNT", "An active account is required"),
      404: errorResponse("Missing application account.", "NOT_FOUND", "User was not found"),
      500: errorResponse("Opaque initialization or authentication failure.", "INTERNAL_ERROR", "Internal server error"),
      502: errorResponse("Opaque provider failure; use manual entry.", "VENUE_SEARCH_FAILED", "Venue search is temporarily unavailable. Enter the venue manually."),
      503: errorResponse("Missing lookup settings; use manual entry.", "VENUE_SEARCH_UNAVAILABLE", "Venue search is not configured. Enter the venue manually."),
    },
  });
}
