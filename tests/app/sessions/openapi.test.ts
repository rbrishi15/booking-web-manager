import SwaggerParser from "@apidevtools/swagger-parser";
import { GET } from "@/app/api/openapi/route";
import { sessionOpenApiDocument } from "@/app/sessions/openapi";
import { createSessionRequestSchema, parseCreateSessionInput } from "@/app/sessions/create-session-input";
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
});
