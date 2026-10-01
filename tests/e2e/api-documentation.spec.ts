import { expect, test } from "@playwright/test";

test("serves the Create Session OpenAPI document", async ({ request }) => {
  // Arrange & Act
  const response = await request.get("/api/openapi");
  const document = await response.json();

  // Assert
  expect(response.status()).toBe(200);
  expect(document.openapi).toMatch(/^3\./);
  const operation = document.paths["/api/sessions"].post;
  expect(operation.security).toEqual([{ bearerAuth: [] }]);
  expect(operation.responses["201"]).toBeDefined();
  expect(operation.responses["503"].content["application/json"].example).toEqual({
    error: {
      code: "SESSION_API_UNAVAILABLE",
      message: "Session creation is not available yet",
    },
  });
});

test("loads the Swagger page and shows the Create Session operation", async ({
  page,
}) => {
  // Arrange & Act
  await page.goto("/api-docs");

  // Assert
  await expect(page.locator("main > p")).toContainText(
    "Session creation requires server configuration; missing settings return 503.",
  );
  await expect(page.getByText("/api/sessions", { exact: true })).toBeVisible();
});
