import { sessionOpenApiDocument } from "@/app/sessions/openapi";

export function GET(): Response {
  return Response.json(sessionOpenApiDocument);
}
