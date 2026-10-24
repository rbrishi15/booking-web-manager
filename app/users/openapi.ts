import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { errorResponse, z } from "@/app/openapi/contracts";
import { USER_HANDLES_UNAVAILABLE_MESSAGE } from "./user-handle-dependencies";

const paramsSchema = z.object({
  handle: z.string().max(64).openapi({
    description: "The exact user ID, with or without a leading @ and in any letter case.",
    example: "marcus_lim",
  }),
});

const userLookupSchema = z.object({
  user: z.object({
    userId: z.string().uuid().openapi({ example: "6f1c2a7e-4b8d-4c1e-9a3f-2d5b7c9e1f03" }),
    handle: z.string().openapi({ description: "The stored user ID: lower case, without @.", example: "marcus_lim" }),
    displayName: z.string().openapi({ example: "Marcus Lim" }),
  }),
});

export function registerUserLookupApi(registry: OpenAPIRegistry): void {
  const found = registry.register("UserLookup", userLookupSchema);

  registry.registerPath({
    method: "get",
    path: "/api/users/by-handle/{handle}",
    operationId: "findUserByHandle",
    tags: ["Users"],
    summary: "Find a player by user ID",
    description: [
      "Finds the active player who holds exactly this user ID (ADR-0021), as typing @name does in Telegram.",
      "User IDs ignore letter case. Only the user's ID, user ID and name are returned; there is no partial-match search.",
      "Deleted accounts free their user ID, so they are never found. Requires migration 0016_user_handles.",
    ].join(" "),
    security: [{ bearerAuth: [] }, { loginCookie: [] }],
    request: { params: paramsSchema },
    responses: {
      200: { description: "The player with this user ID.", content: { "application/json": { schema: found } } },
      400: errorResponse("The user ID breaks the format rules.", "INVALID_INPUT", "A user ID must have 5-32 letters, numbers or underscores, start with a letter, and not end with or repeat an underscore"),
      401: errorResponse("Authentication required.", "UNAUTHENTICATED", "Authentication is required"),
      404: errorResponse("No active player has this user ID.", "NOT_FOUND", "No player has this user ID"),
      500: errorResponse("Opaque infrastructure failure.", "INTERNAL_ERROR", "Internal server error"),
      503: errorResponse("Server settings unavailable.", "USER_IDS_UNAVAILABLE", USER_HANDLES_UNAVAILABLE_MESSAGE),
    },
  });
}
