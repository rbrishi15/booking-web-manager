import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z, errorResponse } from "@/app/openapi/contracts";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
import { MAX_SESSION_SLOTS } from "@/domain/sessions/capacity";
import { DISCOVERY_API_UNAVAILABLE_MESSAGE } from "./discovery-api-unavailable";

/** Registers authenticated session discovery filters, listing responses and safe failure diagnostics. */
export function registerDiscoveryApi(registry: OpenAPIRegistry): void {
  const discoveryResultSchema = registry.register("DiscoverSessionsResult", z.object({
    items: z.array(z.object({
      sessionId: z.string().uuid(),
      venueName: z.string(),
      region: z.string(),
      sport: z.string(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      totalSlots: z.number().int().min(1).max(MAX_SESSION_SLOTS),
      bookingShareCents: z.number().int().positive().safe(),
    })).max(20),
    nextCursor: z.string().nullable(),
  }));
  const discoveryInternalErrorSchema = registry.register("DiscoveryInternalError", z.object({
    error: z.object({
      code: z.literal("INTERNAL_ERROR"),
      message: z.string().openapi({ description: "An explanation and suggested next step without raw exception details." }),
      requestId: z.string().uuid().openapi({ description: "Generated identifier matching X-Request-Id and the server error log." }),
      reason: z.enum([
        "DATABASE_UNAVAILABLE",
        "DATABASE_ACCESS_DENIED",
        "DATABASE_SCHEMA_MISMATCH",
        "INITIALIZATION_FAILED",
        "UNEXPECTED_ERROR",
      ]),
      stage: z.enum(["initialization", "authentication", "validation", "query", "serialization"]),
      diagnostics: z.array(z.object({
        message: z.string().max(500).openapi({ description: "Fixed safe message for an allowlisted error code or exact known message; otherwise Unknown error. Raw exception text, stack traces and SQL fields are never returned." }),
        code: z.string().max(64).optional().openapi({ description: "Allowlisted driver error code, when recognized; unknown codes are omitted." }),
      })).min(1).max(8).openapi({ description: "Bounded safe diagnostics from the exception, nested causes and aggregate errors. Available without server-log access, an environment toggle or operator authentication." }),
    }),
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
      "Lists upcoming PUBLIC, OPEN sessions for signed-in users with ACTIVE profiles, including unverified emails and full sessions.",
      "Only sessions starting strictly after the server clock are returned; minimum reliability and current capacity do not hide listings.",
      "Optional q matches a case-insensitive literal substring of the sport or venue name and combines with every other filter. Percent signs, underscores, and backslashes are literal text, not wildcards. Search text is trimmed, blank text is omitted, and the maximum is 100 characters after trimming.",
      "For example, ?q=Jurong&sport=Badminton&region=West&date=2040-01-02 finds matching West-region badminton sessions starting on that Singapore day.",
      "Optional sport and region filters use the shared profile vocabulary. Regions are the stored booking regions; OneMap resolution is separate work.",
      "Date and time filters use Asia/Singapore (UTC+08:00) and match session starts in a lower-inclusive, upper-exclusive window.",
      "A date alone covers that whole Singapore calendar day. timeFrom or timeTo requires date; omitted bounds default to the start or end of that day.",
      "The lower time must precede the upper time. Blank values are omitted, duplicate known parameters are rejected, and unknown parameters are ignored.",
      "Results are ordered by startAt then sessionId, with at most 20 items per page. Pass the opaque nextCursor unchanged with the same filters for the next page; null means the final page.",
      "The response contains listing fields only, never room tokens or participant, wallet, holding-account, payout, or invitation data. totalSlots is capacity, not remaining availability.",
      "Bearer tokens or same-origin Supabase login cookies are required. Responses use Cache-Control: no-store. Missing settings return 503 DISCOVERY_API_UNAVAILABLE.",
    ].join(" "),
    security: [{ bearerAuth: [] }, { loginCookie: [] }],
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
        description: "A page of public-visibility session listings for an authenticated viewer, or an empty result. All responses use Cache-Control: no-store.",
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
      401: errorResponse("Missing or invalid login cookie or bearer token.", "UNAUTHENTICATED", "Authentication is required"),
      403: errorResponse("The signed-in account is inactive.", "INACTIVE_ACCOUNT", "An inactive account cannot use the session API"),
      404: errorResponse("The signed-in account has no profile.", "NOT_FOUND", "User was not found"),
      500: {
        description: "Discovery failed. The response identifies the failure category and stage with a generated requestId. Diagnostics use fixed safe explanations for allowlisted driver codes and exact known messages. Exact known messages can identify failures even with no code or a generic code; unknown codes are omitted. Unrecognized failures return Unknown error. Raw exception text, stack traces and SQL fields are never returned. Safe diagnostics require no environment toggle or operator authentication. The matching 'Session discovery failed' server-log entry retains the original error and cause.",
        headers: {
          "Cache-Control": { schema: { type: "string", enum: ["no-store"] } },
          "X-Request-Id": {
            description: "The same generated identifier as error.requestId.",
            schema: { type: "string", format: "uuid" },
          },
        },
        content: {
          "application/json": {
            schema: discoveryInternalErrorSchema,
            example: {
              error: {
                code: "INTERNAL_ERROR",
                message: "The sessions database schema does not match this deployment. Check that database migrations have been applied.",
                requestId: "b6b6b6b6-1234-4123-8123-123456789abc",
                reason: "DATABASE_SCHEMA_MISMATCH",
                stage: "query",
                diagnostics: [{ message: "Database column does not exist", code: "42703" }],
              },
            },
          },
        },
      },
      503: errorResponse("Required discovery database or authentication settings are missing.", "DISCOVERY_API_UNAVAILABLE", DISCOVERY_API_UNAVAILABLE_MESSAGE),
    },
  });
}
