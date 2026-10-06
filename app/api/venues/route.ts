import { z } from "zod";
import { loadDependencies } from "@/app/http/load-dependencies";
import { requireUserId } from "@/app/http/require-user-id";
import { invalidRequest } from "@/app/http/request-failure";
import { sessionCreationErrorResponse, errorResponse } from "@/app/sessions/create-session-response";
import { getVenueDependencies } from "@/app/venues/server-dependencies";
import { VenueSearchProviderError, VenueSearchUnavailableError } from "@/lib/venues/contracts";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getVenueDependencies);
    await requireUserId(request, dependencies.authenticate);
    const params = new URL(request.url).searchParams;
    const query = z.string().trim().min(2).max(100).safeParse(params.get("q"));
    const page = z.coerce.number().int().min(1).max(1000).safeParse(params.get("page") ?? "1");
    if (!query.success || !page.success || params.getAll("q").length !== 1 || params.getAll("page").length > 1)
      throw invalidRequest("Enter a venue search of 2–100 characters and a valid page");
    return Response.json(await dependencies.search(query.data, page.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof VenueSearchUnavailableError)
      return errorResponse(503, "VENUE_SEARCH_UNAVAILABLE", "Venue search is not configured. Enter the venue manually.");
    if (error instanceof VenueSearchProviderError)
      return errorResponse(502, "VENUE_SEARCH_FAILED", "Venue search is temporarily unavailable. Enter the venue manually.");
    return sessionCreationErrorResponse(error);
  }
}
