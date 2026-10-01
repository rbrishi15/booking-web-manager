import { parseCreateSessionInput } from "@/app/sessions/create-session-input";
import {
  errorResponse,
  internalErrorResponse,
  sessionCreationErrorResponse,
} from "@/app/sessions/create-session-response";
import type { SessionApiDependencies } from "@/app/sessions/dependencies";
import { getSessionDependencies } from "@/app/sessions/server-dependencies";
import type { UUID } from "@/domain";
import { z } from "zod";

export const runtime = "nodejs";
const authenticatedUserId = z.string().uuid();

export async function POST(request: Request): Promise<Response> {
  let dependencies: SessionApiDependencies;
  let bookerId: UUID;
  try {
    dependencies = await getSessionDependencies();
  } catch {
    return internalErrorResponse();
  }

  try {
    const identity = await dependencies.authenticate(request);
    if (identity === null) {
      return errorResponse(401, "UNAUTHENTICATED", "Authentication is required");
    }
    bookerId = authenticatedUserId.parse(identity);
  } catch (error) {
    return sessionCreationErrorResponse(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return error instanceof SyntaxError
      ? errorResponse(400, "INVALID_REQUEST", "Request body must be valid JSON")
      : internalErrorResponse();
  }

  let parsed: ReturnType<typeof parseCreateSessionInput>;
  try {
    parsed = parseCreateSessionInput(bookerId, body);
  } catch (error) {
    return error instanceof z.ZodError
      ? errorResponse(400, "INVALID_REQUEST", "Invalid session creation request")
      : internalErrorResponse();
  }

  try {
    const { input, submission } = parsed;
    const createSessions = dependencies.createForSubmission(submission);
    const result = await createSessions.forBooker(
      input.bookerId,
      input.booking,
      input.config,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    return sessionCreationErrorResponse(error);
  }
}
