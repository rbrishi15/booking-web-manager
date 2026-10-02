import { openApiDocument } from "@/app/openapi";

export function GET(): Response {
  return Response.json(openApiDocument);
}
