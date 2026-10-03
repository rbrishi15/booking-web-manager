import { createOpenApiDocument } from "@/app/openapi/document";
import { registerSessionApi } from "@/app/sessions/openapi";
import { createSessionRequestSchema, parseCreateSessionInput } from "@/app/sessions/create-session-input";
import { describe, expect, test } from "vitest";

const sessionOpenApiDocument = createOpenApiDocument([registerSessionApi]);

describe("session creation OpenAPI contract", () => {
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
            pricePerSlotCents: { type: "integer", minimum: 0, exclusiveMinimum: true, maximum: Number.MAX_SAFE_INTEGER },
            totalSlots: { type: "number" },
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
