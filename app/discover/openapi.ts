import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
import { DISCOVERY_API_UNAVAILABLE_MESSAGE } from "./discovery-api-unavailable";

export function registerDiscoveryApi(registry: OpenAPIRegistry): void {
  const discoveryResultSchema = registry.register("DiscoverSessionsResult", z.object({
    items: z.array(z.object({
      sessionId: z.string().uuid(),
      venueName: z.string(),
      region: z.string(),
      sport: z.string(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      totalSlots: z.number().int().min(1).max(8),
      bookingShareCents: z.number().int().positive().safe(),
    })).max(20),
    nextCursor: z.string().nullable(),
  }));
  const discoveryExample = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    venueName: "Jurong East Sports Hall",
    region: "West",
    sport: "Badminton",
    startAt: "2040-01-02T10:00:00.000Z",
    endAt: "2040-01-02T12:00:00.000Z",
    totalSlots: 3,
    bookingShareCents: 333,
  };
  const discoveryCursorExample = Buffer.from(JSON.stringify({
    startAt: discoveryExample.startAt,
    sessionId: "11111111-1111-4111-8111-000000000020",
  })).toString("base64url");

  registry.registerPath({
    method: "get",
    path: "/api/sessions",
    operationId: "discoverSessions",
    tags: ["Sessions"],
    summary: "UC2-01 Discover Sessions",
    description: [
      "Lists upcoming PUBLIC, OPEN sessions for everyone, including signed-out and unverified visitors and full sessions.",
      "Only sessions starting strictly after the server clock are returned; minimum reliability and current capacity do not hide listings.",
      "Optional q matches a case-insensitive literal substring of the sport or venue name and combines with every other filter. Percent signs, underscores, and backslashes are literal text, not wildcards. Search text is trimmed, blank text is omitted, and the maximum is 100 characters after trimming.",
      "For example, ?q=Jurong&sport=Badminton&region=West&date=2040-01-02 finds matching West-region badminton sessions starting on that Singapore day.",
      "Optional sport and region filters use the shared profile vocabulary. Regions are the stored booking regions; OneMap resolution is separate work.",
      "Date and time filters use Asia/Singapore (UTC+08:00) and match session starts in a lower-inclusive, upper-exclusive window.",
      "A date alone covers that whole Singapore calendar day. timeFrom or timeTo requires date; omitted bounds default to the start or end of that day.",
      "The lower time must precede the upper time. Blank values are omitted, duplicate known parameters are rejected, and unknown parameters are ignored.",
      "Results are ordered by startAt then sessionId, with at most 20 items per page. Pass the opaque nextCursor unchanged with the same filters for the next page; null means the final page.",
      "The response contains listing fields only, never room tokens or participant, wallet, holding-account, payout, or invitation data. totalSlots is capacity, not remaining availability.",
      "Responses use Cache-Control: no-store. Missing settings return 503 DISCOVERY_API_UNAVAILABLE.",
    ].join(" "),
    security: [],
    request: {
      query: z.object({
        q: z.string().max(100).optional().openapi({
          description: "Case-insensitive literal substring of sport or venue name (trimmed, at most 100 characters). Supply once; blanks are omitted. Combine with sport, region, date, and time filters; preserve it when paging.",
          example: "Jurong",
        }),
        sport: z.enum(SPORTS).optional(),
        region: z.enum(REGIONS).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({
          description: "A valid Singapore calendar date in YYYY-MM-DD form.",
          example: "2040-01-02",
        }),
        timeFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().openapi({
          description: "Inclusive Singapore start time (HH:mm); requires date.",
          example: "18:00",
        }),
        timeTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().openapi({
          description: "Exclusive Singapore start time (HH:mm); requires date.",
          example: "20:00",
        }),
        cursor: z.string().optional().openapi({
          description: "Opaque nextCursor from the preceding response, with unchanged filters.",
          example: discoveryCursorExample,
        }),
      }),
    },
    responses: {
      200: {
        description: "A page of public session listings, or an empty result. All responses use Cache-Control: no-store.",
        headers: { "Cache-Control": { schema: { type: "string", enum: ["no-store"] } } },
        content: {
          "application/json": {
            schema: discoveryResultSchema,
            examples: {
              populated: { summary: "A final page with one session", value: { items: [discoveryExample], nextCursor: null } },
              empty: { summary: "No matching sessions", value: { items: [], nextCursor: null } },
              pagination: {
                summary: "A page with more sessions available",
                value: {
                  items: Array.from({ length: 20 }, (_, index) => ({
                    ...discoveryExample,
                    sessionId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
                  })),
                  nextCursor: discoveryCursorExample,
                },
              },
            },
          },
        },
      },
      400: errorResponse("Malformed or duplicate filters, search text longer than 100 characters after trimming, invalid calendar date/time range, or invalid cursor.", "INVALID_REQUEST", "Invalid session discovery query"),
      500: errorResponse("Unexpected configuration or persistence failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
      503: errorResponse("Required discovery server settings are missing.", "DISCOVERY_API_UNAVAILABLE", DISCOVERY_API_UNAVAILABLE_MESSAGE),
    },
  });
}
