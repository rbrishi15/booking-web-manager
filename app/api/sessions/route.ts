import { readCreateSessionRequest } from "@/app/sessions/create-session-input";
import { sessionCreationErrorResponse } from "@/app/sessions/create-session-response";
import { getSessionDependencies } from "@/app/sessions/server-dependencies";
import { getDiscoveryDependencies } from "@/app/discover/server-dependencies";
import { readDiscoveryRequest } from "@/app/discover/request";
import { toDiscoveryPage } from "@/app/discover/contracts";
import {
  discoveryErrorResponse,
  discoveryJson,
} from "@/app/discover/response";
import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getDiscoveryDependencies);
    const { criteria, after } = readDiscoveryRequest(request);
    const sessions = await dependencies.discoverSessions.searchPublic(criteria);
    return discoveryJson(toDiscoveryPage(sessions, after));
  } catch (error) {
    return discoveryErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getSessionDependencies);
    const bookerId = await requireUserId(request, dependencies.authenticate);
    const { input, submission } = await readCreateSessionRequest(request, bookerId);
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
