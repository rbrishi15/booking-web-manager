import { expect, test } from "vitest";
import { openApiDocument } from "@/app/openapi";
import { toUserLookupResponse } from "@/app/users/user-lookup-response";

// Owner: Joseph (Jolingoes) — /app/users (ADR-0021)
test("documents the signed-in user ID lookup with its error responses", () => {
  // Act
  const operation = openApiDocument.paths["/api/users/by-handle/{handle}"]?.get;

  // Assert
  expect(operation?.operationId).toBe("findUserByHandle");
  expect(operation?.security).toEqual([{ bearerAuth: [] }, { loginCookie: [] }]);
  expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "401", "404", "500", "503"]);
  expect(operation?.parameters).toContainEqual(expect.objectContaining({
    name: "handle", in: "path", required: true, schema: expect.objectContaining({ type: "string", maxLength: 64 }),
  }));
});

test("documents exactly the fields the route serializes", () => {
  // Arrange
  const serialized = toUserLookupResponse({ userId: "6f1c2a7e-4b8d-4c1e-9a3f-2d5b7c9e1f03", handle: "marcus_lim", displayName: "Marcus Lim" });

  // Act
  const schema = openApiDocument.components?.schemas?.UserLookup;

  // Assert
  expect(schema).toMatchObject({
    required: ["user"],
    properties: { user: { required: ["userId", "handle", "displayName"], properties: { userId: { format: "uuid" } } } },
  });
  expect(Object.keys(serialized.user).sort()).toEqual(["displayName", "handle", "userId"]);
});
