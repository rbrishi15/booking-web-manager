import { describe, expect, test } from "vitest";
import SwaggerParser from "@apidevtools/swagger-parser";
import { openApiDocument } from "@/app/openapi";

describe("Wallet OpenAPI contracts", () => {
  const paths = [
    "/api/wallet",
    "/api/wallet/transactions",
    "/api/wallet/top-up",
  ] as const;

  test("validates against OpenAPI 3.0.3 specification", async () => {
    await expect(
      SwaggerParser.validate(await Response.json(openApiDocument).json()),
    ).resolves.toBeDefined();
  });

  test.each(paths)("%s is mounted in OpenAPI document", (path) => {
    expect(openApiDocument.paths[path]).toBeDefined();
  });

  test("GET /api/wallet is documented with correct operationId, tags, and responses", () => {
    const operation = openApiDocument.paths["/api/wallet"]?.get;
    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe("getWallet");
    expect(operation?.tags).toEqual(["Wallet"]);
    expect(operation?.security).toEqual([{ bearerAuth: [] }, { loginCookie: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      "200",
      "401",
      "403",
      "404",
      "500",
      "503",
    ]);

    const res200 = operation?.responses["200"];
    expect(res200).toBeDefined();
    if (res200 && "content" in res200) {
      const example = res200.content?.["application/json"]?.example;
      expect(example).toMatchObject({
        currency: "SGD",
        availableBalanceCents: expect.any(Number),
        heldBalanceCents: expect.any(Number),
        activeHolds: expect.any(Array),
      });
    }
  });

  test("GET /api/wallet/transactions is documented with query params and responses", () => {
    const operation = openApiDocument.paths["/api/wallet/transactions"]?.get;
    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe("listWalletTransactions");
    expect(operation?.tags).toEqual(["Wallet"]);
    expect(operation?.security).toEqual([{ bearerAuth: [] }, { loginCookie: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "500",
      "503",
    ]);
  });

  test("POST /api/wallet/top-up is documented with request body and responses", () => {
    const operation = openApiDocument.paths["/api/wallet/top-up"]?.post;
    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe("createWalletTopUp");
    expect(operation?.tags).toEqual(["Wallet"]);
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual([
      "201",
      "400",
      "401",
      "403",
      "404",
      "422",
      "500",
      "503",
    ]);

    const reqBody = operation?.requestBody;
    expect(reqBody).toBeDefined();
    if (reqBody && "content" in reqBody) {
      const example = reqBody.content["application/json"]?.example;
      expect(example).toMatchObject({
        amountCents: 5000,
        idempotencyKey: expect.any(String),
      });
    }
  });

  test("wallet schemas are registered in openApiDocument components", () => {
    const schemas = openApiDocument.components?.schemas;
    expect(schemas?.WalletSummary).toBeDefined();
    expect(schemas?.WalletTransactionsResponse).toBeDefined();
    expect(schemas?.WalletTopUpRequest).toBeDefined();
    expect(schemas?.WalletTopUpResult).toBeDefined();
  });
});
