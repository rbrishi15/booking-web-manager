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

test("returns discovery unavailable without configuration and does not cache it", async ({ request }) => {
  const response = await request.get("/api/sessions");

  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({
    error: {
      code: "DISCOVERY_API_UNAVAILABLE",
      message: "Session discovery is not available yet",
    },
  });
});

test("returns management unavailable without configuration", async ({ request }) => {
  const response = await request.patch("/api/sessions/10000000-0000-4000-8000-000000000001/visibility", {
    data: { visibility: "PUBLIC" },
  });
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({
    error: { code: "SESSION_MANAGEMENT_UNAVAILABLE", message: "Session management is not available yet" },
  });
});

test("returns cancellation unavailable without configuration", async ({ request }) => {
  const base = "/api/sessions/10000000-0000-4000-8000-000000000001";
  const responses = [
    await request.get(`${base}/cancellation-preview`),
    await request.post(`${base}/cancel`, { data: {} }),
  ];
  for (const response of responses) {
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE" } });
  }
});
