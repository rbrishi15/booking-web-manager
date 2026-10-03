import { createOpenApiDocument } from "@/app/openapi/document";
import { registerDiscoveryApi } from "@/app/discover/openapi";
import { parseDiscoveryQuery } from "@/app/discover/query";
import { describe, expect, test } from "vitest";

const discoveryOpenApiDocument = createOpenApiDocument([registerDiscoveryApi]);

describe("session discovery OpenAPI contract", () => {
  test("documents discovery filters, public listing fields, pagination and failures", () => {
    const operation = discoveryOpenApiDocument.paths["/api/sessions"]?.get;
    expect(operation?.security).toEqual([]);
    expect(operation?.parameters?.map((parameter) => "name" in parameter ? parameter.name : undefined)).toEqual([
      "q", "sport", "region", "date", "timeFrom", "timeTo", "cursor",
    ]);
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      "200", "400", "500", "503",
    ]);
    expect(operation?.description).toContain("Asia/Singapore");
    expect(operation?.description).toContain("and full sessions");
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
    expect(discoveryOpenApiDocument.components?.schemas?.DiscoverSessionsResult).toMatchObject({
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
    const result = JSON.stringify(discoveryOpenApiDocument.components?.schemas?.DiscoverSessionsResult);
    for (const sensitiveField of ["roomToken", "bookerId", "walletId", "holdingAccountId", "invitedGroupId", "participations"]) {
      expect(result).not.toContain(sensitiveField);
    }
  });

  test("provides meaningful populated, empty and paginated discovery examples", () => {
    const response = discoveryOpenApiDocument.paths["/api/sessions"]?.get?.responses["200"];
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
