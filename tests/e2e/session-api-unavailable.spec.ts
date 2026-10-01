import { expect, test } from "@playwright/test";

test("returns unavailable for a documented submission instead of creating a session", async ({ request }) => {
  // Arrange
  const specification = await request.get("/api/openapi");
  expect(specification.status()).toBe(200);
  const document = await specification.json();
  const body = document.paths["/api/sessions"].post.requestBody.content["application/json"].example;

  // Act
  const response = await request.post("/api/sessions", { data: body });

  // Assert
  expect(response.status()).toBe(503);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({
    error: {
      code: "SESSION_API_UNAVAILABLE",
      message: "Session creation is not available yet",
    },
  });
});
