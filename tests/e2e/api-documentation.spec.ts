import { expect, test } from "@playwright/test";

test("serves the session creation and discovery OpenAPI document", async ({ request }) => {
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
  const discovery = document.paths["/api/sessions"].get;
  expect(discovery.security).toEqual([{ bearerAuth: [] }]);
  expect(discovery.responses["200"].content["application/json"].examples.empty.value).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(discovery.responses["503"].content["application/json"].example.error.code).toBe("DISCOVERY_API_UNAVAILABLE");
});

test("loads the Swagger page and shows both session operations", async ({
  page,
}) => {
  // Arrange & Act
  await page.goto("/api-docs");

  // Assert
  await expect(page.locator("main > p")).toContainText(
    "Both require server configuration; missing settings return 503.",
  );
  await expect(page.locator(".opblock-get").getByText("/api/sessions", { exact: true })).toBeVisible();
  await expect(page.locator(".opblock-post").getByText("/api/sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-01 Discover Sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-02 Create Session", { exact: true })).toBeVisible();
});
