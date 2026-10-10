import SwaggerParser from "@apidevtools/swagger-parser";
import { expect, test } from "@playwright/test";
import { z } from "zod";

const discoveryPageSchema = z.object({
  items: z.array(
    z.object({
      sessionId: z.string().uuid(),
      venueName: z.string(),
      region: z.string(),
      sport: z.string(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      totalSlots: z.number().int().min(1).max(8),
      bookingShareCents: z.number().int().positive().safe(),
    }).strict(),
  ).max(20),
  nextCursor: z.string().nullable(),
}).strict();

test("production serves its OpenAPI contract", async ({ request }) => {
  const response = await request.get("/api/openapi");
  expect(response.status()).toBe(200);

  const document = await response.json();
  await expect(SwaggerParser.validate(structuredClone(document))).resolves.toBeDefined();
  expect(document.openapi).toMatch(/^3\./);
  expect(document.paths?.["/api/sessions"]?.get).toBeDefined();
});

test("production session discovery reads from a working database", async ({ request }) => {
  const response = await request.get("/api/sessions");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const parsed = discoveryPageSchema.safeParse(await response.json());
  expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(true);
});
