import { expect, test } from "@playwright/test";

test("serves the shared OpenAPI document with creation, discovery and visibility", async ({ request }) => {
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
  const visibility = document.paths["/api/sessions/{sessionId}/visibility"].patch;
  expect(visibility.security).toEqual([{ bearerAuth: [] }]);
  expect(visibility.requestBody.content["application/json"].example).toEqual({ visibility: "PUBLIC" });
  expect(visibility.responses["200"]).toBeDefined();
  expect(visibility.responses["503"].content["application/json"].example.error.code).toBe("SESSION_MANAGEMENT_UNAVAILABLE");
  const cancellation = document.paths["/api/sessions/{sessionId}/cancel"].post;
  expect(cancellation.security).toEqual([{ bearerAuth: [] }]);
  expect(cancellation.responses["200"]).toBeDefined();
  expect(document.paths["/api/sessions/{sessionId}/cancellation-preview"].get.responses["200"]).toBeDefined();
});

test("loads the shared Swagger page and enables discovery requests", async ({
  page,
}) => {
  // Arrange & Act
  await page.goto("/api-docs");

  // Assert
  await expect(page.getByRole("heading", { name: /^Booking Web Manager API/ })).toBeVisible();
  const discovery = page.locator(".opblock-get").filter({ has: page.getByText("/api/sessions", { exact: true }) });
  await expect(discovery.getByText("/api/sessions", { exact: true })).toBeVisible();
  await expect(page.locator(".opblock-post").getByText("/api/sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-01 Discover Sessions", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-02 Create Session", { exact: true })).toBeVisible();
  await expect(page.locator(".opblock-patch").getByText("/api/sessions/{sessionId}/visibility", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-03c Preview cancellation refunds", { exact: true })).toBeVisible();
  await expect(page.getByText("UC2-03c Cancel a session and refund outstanding holds", { exact: true })).toBeVisible();

  // The shared UI exposes Swagger's normal request controls for GET as well as POST.
  await discovery.locator(".opblock-summary").click();
  await discovery.getByRole("button", { name: "Try it out", exact: true }).click();
  await expect(discovery.getByRole("button", { name: "Execute", exact: true })).toBeEnabled();
});
