import { expect, test } from "@playwright/test";

test("serves the Create Session OpenAPI document", async ({ request }) => {
  // Arrange & Act
  const response = await request.get("/api/openapi");
  const document = await response.json();

  // Assert
  expect(response.status()).toBe(200);
  expect(document.openapi).toMatch(/^3\./);
  expect(document.paths["/api/sessions"].post).toBeDefined();
});

test("loads the Swagger page and shows the Create Session operation", async ({
  page,
}) => {
  // Arrange & Act
  await page.goto("/api-docs");

  // Assert
  await expect(page.getByText("/api/sessions", { exact: true })).toBeVisible();
});
