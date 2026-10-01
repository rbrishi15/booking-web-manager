import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { apiErrorSchema } from "./contracts";

/** Assemble public metadata with a fresh registry for each document. */
export function createOpenApiDocument(
  registrations: readonly ((registry: OpenAPIRegistry) => void)[],
) {
  const registry = new OpenAPIRegistry();
  registry.register("ApiError", apiErrorSchema);
  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Supabase bearer token. Authentication and account requirements are documented per operation.",
  });

  for (const register of registrations) register(registry);
  assertUniqueOperations(registry);

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Booking Web Manager API",
      version: "1.0.0",
      description: "API reference for Booking Web Manager. Each operation documents its authentication, configuration, request and response requirements.",
    },
    servers: [{ url: "/", description: "This server" }],
  });
}

function assertUniqueOperations(registry: OpenAPIRegistry): void {
  const operations = new Set<string>();
  const operationIds = new Set<string>();
  for (const definition of registry.definitions) {
    if (definition.type !== "route") continue;
    const { method, path, operationId } = definition.route;
    const operation = `${method.toUpperCase()} ${path}`;
    if (operations.has(operation))
      throw new Error(`Duplicate OpenAPI operation: ${operation}`);
    operations.add(operation);
    if (operationId !== undefined) {
      if (operationIds.has(operationId))
        throw new Error(`Duplicate OpenAPI operationId: ${operationId}`);
      operationIds.add(operationId);
    }
  }
}
