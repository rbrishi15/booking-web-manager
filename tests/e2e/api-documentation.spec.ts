import { expect, test } from "@playwright/test";

test("serves the shared OpenAPI document with creation and discovery", async ({ request }) => {
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

test("loads the shared Swagger page and enables discovery requests", async ({
  page,
}) => {
  // Arrange & Act
  await page.goto("/api-docs");

  // Assert
  await expect(page.getByRole("heading", { name: /^Booking Web Manager API/ })).toBeVisible();
  const discovery = page.locator(".opblock-get");
  await expect(discovery.getByText("/api/sessions", { exact: true })).toBeVisible();
  await expect(page.locator(".opblock-post").getByText("/api/sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-01 Discover Sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-02 Create Session", { exact: true })).toBeVisible();

  // The shared UI exposes Swagger's normal request controls for GET as well as POST.
  await discovery.locator(".opblock-summary").click();
  await discovery.getByRole("button", { name: "Try it out", exact: true }).click();
  await expect(discovery.getByRole("button", { name: "Execute", exact: true })).toBeEnabled();
});
