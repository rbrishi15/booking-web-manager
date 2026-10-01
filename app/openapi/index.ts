import { registerDiscoveryApi } from "@/app/discover/openapi";
import { registerSessionApi } from "@/app/sessions/openapi";
import { createOpenApiDocument } from "./document";

/** Add feature documentation here; the public route and Swagger UI stay generic. */
export const openApiDocument = createOpenApiDocument([
  registerSessionApi,
  registerDiscoveryApi,
]);
