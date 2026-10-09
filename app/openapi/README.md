# /app/openapi

This module assembles the public API reference. [`index.ts`](./index.ts) passes an
explicit list of feature registration functions to
[`createOpenApiDocument`](./document.ts). Each call creates a fresh registry with
shared API metadata and the `bearerAuth` and `loginCookie` security schemes.
`loginCookie` (the Supabase login cookies) may be listed only by read (`GET`)
operations; operations that change data require `bearerAuth`.
[`contracts.ts`](./contracts.ts) supplies OpenAPI-enabled `z` and the shared
`errorResponse` helper. Features own their operation descriptions, schemas,
examples, authentication requirements and response codes.

[`GET /api/openapi`](../api/openapi/route.ts) serves the assembled document.
[`/api-docs`](../api-docs/page.tsx) displays it with the shared Swagger UI.
The reference is public; authentication and availability are documented per
operation. Try it out sends real requests using Swagger's default supported HTTP
methods. Authorization is not persisted, and the online validator badge is
disabled.

The [commitment registration](../commit/openapi.ts) also describes UC2-04/05/06
handler contracts awaiting route implementation. Their URLs are proposed and
each operation explicitly states that no Next.js route is mounted yet. The feature
owner will confirm paths and wire production dependencies; publishing these
schemas does not make the workflows callable. The scheduler uses its own
`cronAuth` scheme for `CRON_SECRET`, separate from the user `bearerAuth` JWT.

## Add a feature

1. Add `openapi.ts` beside the feature's HTTP contracts. Export a registration
   function that accepts `OpenAPIRegistry`, reuses request schemas where possible,
   and registers that feature's components and operations.
2. Import the function in [`index.ts`](./index.ts) and add it to the explicit
   registration list. The serving route and Swagger component need no changes.
3. Add contract tests for the operation, including its security, successful
   responses and relevant errors. Keep the assembled-document validation and
   [Swagger browser coverage](../../tests/e2e/api-documentation.spec.ts) passing.

For example, a new feature could register an authenticated operation as follows:

```ts
// app/example/openapi.ts
import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { errorResponse, z } from "@/app/openapi/contracts";

export function registerExampleApi(registry: OpenAPIRegistry): void {
  const resultSchema = registry.register(
    "ExampleResult",
    z.object({ message: z.string() }),
  );

  registry.registerPath({
    method: "get",
    path: "/api/example",
    operationId: "getExample",
    tags: ["Examples"],
    summary: "Read an example",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "The example response.",
        content: { "application/json": { schema: resultSchema } },
      },
      401: errorResponse(
        "Missing or invalid credentials.",
        "UNAUTHENTICATED",
        "Authentication is required",
      ),
    },
  });
}
```

Then add its import and registration to the composition root:

```ts
// app/openapi/index.ts
import { registerDiscoveryApi } from "@/app/discover/openapi";
import { registerExampleApi } from "@/app/example/openapi";
import { registerSessionApi } from "@/app/sessions/openapi";
import { createOpenApiDocument } from "./document";

export const openApiDocument = createOpenApiDocument([
  registerSessionApi,
  registerDiscoveryApi,
  registerExampleApi,
]);
```

Use unique component names and `operationId` values across the complete document,
and register each method/path pair once. Set `security: []` for a public operation;
document the actual endpoint's account checks and availability in that operation.
Registration only describes the API; it does not create routes or enforce access.

Keep all imports safe for public documentation generation. Reuse pure schemas
and constants, but do not import server dependency getters, read environment
settings, connect to services, or include credentials and secrets in examples.
The existing [creation](../sessions/openapi.ts) and
[discovery](../discover/openapi.ts) registrations provide complete examples.
