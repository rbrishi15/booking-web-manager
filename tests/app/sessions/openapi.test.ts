import SwaggerParser from "@apidevtools/swagger-parser";
import { GET } from "@/app/api/openapi/route";
import { sessionOpenApiDocument } from "@/app/sessions/openapi";
import { createSessionRequestSchema, parseCreateSessionInput } from "@/app/sessions/create-session-input";
import { parseDiscoveryQuery } from "@/app/discover/query";
import { describe, expect, test } from "vitest";

describe("public session OpenAPI contract", () => {
  test("publishes a structurally valid OpenAPI 3.0.3 document without authentication", async () => {
    const response = GET();
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(SwaggerParser.validate(structuredClone(document))).resolves.toBeDefined();
    expect(document.openapi).toBe("3.0.3");
    expect(document.servers).toEqual([{ url: "/", description: "This server" }]);
  });

  test("describes configured bearer authentication and missing-settings unavailability", () => {
    const operation = sessionOpenApiDocument.paths["/api/sessions"]?.post;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(sessionOpenApiDocument.components?.securitySchemes).toMatchObject({
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    });
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      "201", "400", "401", "403", "404", "409", "422", "500", "503",
    ]);
    expect(operation?.description).toContain("missing settings return 503 SESSION_API_UNAVAILABLE");
    expect(operation?.responses["503"]).toMatchObject({
      content: {
        "application/json": {
          example: {
            error: {
              code: "SESSION_API_UNAVAILABLE",
              message: "Session creation is not available yet",
            },
          },
        },
      },
    });
  });

  test("generates JSON timestamp and money types without promoting business rules into structural validation", () => {
    const schema = sessionOpenApiDocument.components?.schemas?.CreateSessionRequest;

    expect(schema).toMatchObject({
      type: "object",
      required: ["idempotencyKey", "booking", "config"],
      properties: {
        idempotencyKey: { type: "string", maxLength: 200, pattern: "\\S" },
        booking: {
          properties: {
            startAt: { type: "string", format: "date-time" },
            endAt: { type: "string", format: "date-time" },
            totalCostCents: { type: "integer" },
          },
        },
        config: {
          properties: {
            totalSlots: { type: "number" },
            minimumHeadcount: { type: "number" },
          },
        },
      },
    });
  });

  test("accepts the documented example through the same transport schema and converts it for the use case", () => {
    const body = sessionOpenApiDocument.paths["/api/sessions"]?.post?.requestBody;
    if (!body || !("content" in body)) throw new Error("Missing request body");
    const example = body.content["application/json"]?.example;

    const transport = createSessionRequestSchema.parse(example);
    const { input } = parseCreateSessionInput("11111111-1111-4111-8111-111111111111", example);

    expect(typeof transport.booking.startAt).toBe("string");
    expect(input.booking.startAt).toBeInstanceOf(Date);
    expect(input.booking.totalCostCents).toBe(1001);
    expect(input.config.totalSlots).toBe(3);
  });

  test("documents discovery filters, public listing fields, pagination and failures", () => {
    const operation = sessionOpenApiDocument.paths["/api/sessions"]?.get;
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.parameters?.map((parameter) => "name" in parameter ? parameter.name : undefined)).toEqual([
      "q", "sport", "region", "date", "timeFrom", "timeTo", "cursor",
    ]);
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      "200", "400", "401", "403", "404", "500", "503",
    ]);
    expect(operation?.description).toContain("Asia/Singapore");
    expect(operation?.description).toContain("including full sessions");
    expect(operation?.description).toContain("OneMap resolution is separate work");
    expect(operation?.description).toContain("case-insensitive literal substring");
    const query = operation?.parameters?.find((parameter) => "name" in parameter && parameter.name === "q");
    expect(query).toMatchObject({ in: "query", required: false, schema: { type: "string", maxLength: 100, example: "Jurong" } });
    expect(parseDiscoveryQuery(new URLSearchParams({ q: "Jurong", sport: "Badminton", region: "West" }))).toMatchObject({
      status: "valid", criteria: { text: "Jurong", sport: "Badminton", region: "West" },
    });
    expect(operation?.responses["503"]).toMatchObject({
      content: {
        "application/json": {
          example: { error: { code: "DISCOVERY_API_UNAVAILABLE", message: "Session discovery is not available yet" } },
        },
      },
    });
    expect(sessionOpenApiDocument.components?.schemas?.DiscoverSessionsResult).toMatchObject({
      properties: {
        items: {
          type: "array",
          maxItems: 20,
          items: {
            properties: {
              sessionId: { type: "string", format: "uuid" },
              startAt: { type: "string", format: "date-time" },
              bookingShareCents: { type: "integer" },
            },
          },
        },
        nextCursor: { type: "string", nullable: true },
      },
    });
    const result = JSON.stringify(sessionOpenApiDocument.components?.schemas?.DiscoverSessionsResult);
    for (const sensitiveField of ["roomToken", "bookerId", "walletId", "holdingAccountId", "invitedGroupId", "participations"]) {
      expect(result).not.toContain(sensitiveField);
    }
  });

  test("provides meaningful populated, empty and paginated discovery examples", () => {
    const response = sessionOpenApiDocument.paths["/api/sessions"]?.get?.responses["200"];
    if (!response || !("content" in response)) throw new Error("Missing discovery response");
    const examples = response.content?.["application/json"]?.examples;
    if (!examples) throw new Error("Missing discovery examples");
    const populated = examples.populated;
    const empty = examples.empty;
    const pagination = examples.pagination;
    if (!populated || !("value" in populated) || !empty || !("value" in empty) || !pagination || !("value" in pagination)) {
      throw new Error("Discovery examples must be inline values");
    }
    expect(populated.value.items).toHaveLength(1);
    expect(populated.value.nextCursor).toBeNull();
    expect(empty.value).toEqual({ items: [], nextCursor: null });
    expect(pagination.value.items).toHaveLength(20);
    expect(new Set(pagination.value.items.map((item: { sessionId: string }) => item.sessionId)).size).toBe(20);
    expect(JSON.parse(Buffer.from(pagination.value.nextCursor, "base64url").toString("utf8"))).toEqual({
      startAt: pagination.value.items.at(-1).startAt,
      sessionId: pagination.value.items.at(-1).sessionId,
    });
  });
});
