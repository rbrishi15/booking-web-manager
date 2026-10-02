import { expect, test } from "vitest";
import { openApiDocument } from "@/app/openapi";
import { parseSessionVisibilityInput } from "@/app/sessions/visibility-input";

test("publishes the bearer-authenticated visibility operation with all response statuses", () => {
  const operation = openApiDocument.paths["/api/sessions/{sessionId}/visibility"]?.patch;
  expect(operation?.operationId).toBe("setSessionVisibility");
  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "401", "403", "404", "409", "500", "503"]);
  expect(operation?.parameters).toEqual([expect.objectContaining({ name: "sessionId", in: "path", required: true, schema: { type: "string", format: "uuid" } })]);
  expect(openApiDocument.components?.schemas?.SessionVisibilityRequest).toMatchObject({ required: ["visibility"], properties: { visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"] } } });
});

test("the documented request example passes the actual input parser", () => {
  const body = openApiDocument.paths["/api/sessions/{sessionId}/visibility"]?.patch?.requestBody;
  if (!body || !("content" in body)) throw new Error("Missing visibility request body");
  const sessionId = "10000000-0000-4000-8000-000000000001";
  expect(parseSessionVisibilityInput(sessionId, body.content["application/json"]?.example)).toEqual({ sessionId, visibility: "PUBLIC" });
});
