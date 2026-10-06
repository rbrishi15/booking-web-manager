import { expect, test } from "vitest";
import { openApiDocument } from "@/app/openapi";
import { parseRemovalInput } from "@/app/sessions/removal-input";

test.each([
  ["/api/sessions/{sessionId}/participants", "get", "listSessionParticipants"],
  ["/api/sessions/{sessionId}/participants/{participationId}/removal-preview", "get", "previewParticipantRemoval"],
  ["/api/sessions/{sessionId}/participants/{participationId}/remove", "post", "removeParticipant"],
] as const)("documents authenticated %s with error responses", (path, method, operationId) => {
  const operation = openApiDocument.paths[path]?.[method];
  expect(operation?.operationId).toBe(operationId);
  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "401", "403", "404", "409", "500", "503"]);
  expect(operation?.parameters).toContainEqual(expect.objectContaining({ name: "sessionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }));
  if (path.includes("{participationId}")) expect(operation?.parameters).toContainEqual(expect.objectContaining({ name: "participationId", in: "path", required: true, schema: { type: "string", format: "uuid" } }));
});

test("documents exact financial DTOs and validates the request example with the actual parser", () => {
  const schemas = openApiDocument.components?.schemas;
  expect(schemas?.ParticipantRemovalPreview).toMatchObject({ required: ["sessionId", "participationId", "refundCents", "previewVersion"], properties: { refundCents: { type: "integer", minimum: 0 } } });
  expect(schemas?.ParticipantRemovalRequest).toMatchObject({ required: ["idempotencyKey", "previewVersion"] });
  expect(schemas?.ParticipantRemovalResult).toMatchObject({ required: ["sessionId", "participationId", "status", "refundCents"], properties: { status: { enum: ["REMOVED"] } } });
  expect(schemas?.SessionParticipants).toMatchObject({ properties: { startAt: { type: "string", format: "date-time" }, endAt: { type: "string", format: "date-time" } } });
  const body = openApiDocument.paths["/api/sessions/{sessionId}/participants/{participationId}/remove"]?.post?.requestBody;
  if (!body || !("content" in body)) throw new Error("Missing removal request body");
  const sessionId = "10000000-0000-4000-8000-000000000001";
  const participationId = "20000000-0000-4000-8000-000000000001";
  expect(parseRemovalInput(sessionId, participationId, body.content["application/json"]?.example)).toEqual({
    sessionId, participationId, idempotencyKey: "30000000-0000-4000-8000-000000000001", previewVersion: "a".repeat(64),
  });
});
