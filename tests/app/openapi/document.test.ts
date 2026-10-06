import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { GET } from "@/app/api/openapi/route";
import { registerDiscoveryApi } from "@/app/discover/openapi";
import { openApiDocument } from "@/app/openapi";
import { errorResponse, z } from "@/app/openapi/contracts";
import { createOpenApiDocument } from "@/app/openapi/document";
import { registerSessionApi } from "@/app/sessions/openapi";
import { describe, expect, test } from "vitest";

function registerNoticesApi(registry: OpenAPIRegistry) {
  const noticeSchema = registry.register("Notice", z.object({
    id: z.string().uuid(),
    title: z.string(),
  }));
  registry.registerPath({
    method: "get",
    path: "/api/notices",
    operationId: "listNotices",
    responses: {
      200: {
        description: "Public notices",
        content: { "application/json": { schema: z.array(noticeSchema) } },
      },
      503: errorResponse("Notices are unavailable", "NOTICES_UNAVAILABLE", "Try again later"),
    },
  });
}

describe("application OpenAPI document", () => {
  test("publishes the composed, structurally valid OpenAPI 3.0.3 document without authentication", async () => {
    const response = GET();
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(document).toEqual(openApiDocument);
    await expect(SwaggerParser.validate(structuredClone(document))).resolves.toBeDefined();
    expect(document.openapi).toBe("3.0.3");
    expect(document.servers).toEqual([{ url: "/", description: "This server" }]);
    expect(document.paths["/api/sessions"]).toMatchObject({
      get: { operationId: "discoverSessions" },
      post: { operationId: "createSession" },
    });
    expect(document.paths["/api/venues"]?.get).toMatchObject({ operationId: "searchVenues", security: [{ bearerAuth: [] }] });
  });

  test("composes an independent public feature without imposing session authentication", async () => {
    const document = createOpenApiDocument([
      registerSessionApi, registerNoticesApi, registerDiscoveryApi,
    ]);

    expect(Object.keys(document.paths).sort()).toEqual(["/api/notices", "/api/sessions"]);
    expect(document.paths["/api/notices"]?.get?.operationId).toBe("listNotices");
    expect(document.components?.schemas?.Notice).toMatchObject({
      type: "object", properties: { id: { format: "uuid" }, title: { type: "string" } },
    });
    expect(document.security).toBeUndefined();
    expect(document.paths["/api/notices"]?.get?.security).toBeUndefined();
    expect(document.paths["/api/sessions"]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths["/api/sessions"]?.post?.security).toEqual([{ bearerAuth: [] }]);
    await expect(SwaggerParser.validate(await Response.json(document).json())).resolves.toBeDefined();
  });

  test("merges distinct methods at the same path and resolves shared error and security references", async () => {
    const document = createOpenApiDocument([registerSessionApi, registerDiscoveryApi]);
    const path = document.paths["/api/sessions"];

    expect(path?.get?.operationId).toBe("discoverSessions");
    expect(path?.post?.operationId).toBe("createSession");
    expect(document.components?.securitySchemes).toEqual({
      bearerAuth: expect.objectContaining({ type: "http", scheme: "bearer", bearerFormat: "JWT" }),
    });
    expect(document.components?.schemas?.ApiError).toMatchObject({
      type: "object",
      properties: { error: { properties: { code: { type: "string" }, message: { type: "string" } } } },
    });
    for (const operation of [path?.get, path?.post]) {
      expect(operation?.responses["401"]).toMatchObject({
        content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
      });
    }
    await expect(SwaggerParser.validate(await Response.json(document).json())).resolves.toBeDefined();
  });

  test("uses fresh registrations for each generation without accumulating other features", () => {
    const first = createOpenApiDocument([registerNoticesApi]);
    const second = createOpenApiDocument([registerSessionApi]);
    const repeated = createOpenApiDocument([registerNoticesApi]);

    expect(Object.keys(first.paths)).toEqual(["/api/notices"]);
    expect(Object.keys(second.paths)).toEqual(["/api/sessions"]);
    expect(second.paths["/api/sessions"]?.get).toBeUndefined();
    expect(second.components?.schemas?.Notice).toBeUndefined();
    expect(first.components?.schemas?.CreateSessionRequest).toBeUndefined();
    expect(repeated).toEqual(first);
  });

  test("rejects the same method and path instead of overwriting an earlier feature", () => {
    const conflictingFeature = (registry: OpenAPIRegistry) => registry.registerPath({
      method: "get",
      path: "/api/notices",
      operationId: "readAnnouncements",
      responses: { 200: { description: "Announcements" } },
    });

    expect(() => createOpenApiDocument([registerNoticesApi, conflictingFeature]))
      .toThrow("Duplicate OpenAPI operation: GET /api/notices");
  });

  test("rejects an operation ID reused by a different method and path", () => {
    const conflictingFeature = (registry: OpenAPIRegistry) => registry.registerPath({
      method: "post",
      path: "/api/announcements",
      operationId: "listNotices",
      responses: { 201: { description: "Announcement created" } },
    });

    expect(() => createOpenApiDocument([registerNoticesApi, conflictingFeature]))
      .toThrow("Duplicate OpenAPI operationId: listNotices");
  });
});
