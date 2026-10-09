import { parsePushEndpoint, parsePushSubscription } from "@/app/commit/push-subscription-input";
import { pushSubscriptionErrorResponse } from "@/app/commit/push-subscription-response";
import { getPushSubscriptionDependencies } from "@/app/commit/push-subscription-server-dependencies";
import { loadDependencies } from "@/app/http/load-dependencies";
import { invalidRequest } from "@/app/http/request-failure";
import { requireUserId } from "@/app/http/require-user-id";

export const runtime = "nodejs";

/** Registers this browser to receive the signed-in user's commitment notifications. */
export async function POST(request: Request): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getPushSubscriptionDependencies);
    const userId = await requireUserId(request, dependencies.authenticate);
    const subscription = parsePushSubscription(await jsonBody(request));
    await dependencies.subscriptions.register(userId, subscription);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return pushSubscriptionErrorResponse(error);
  }
}

/** Stops sending to this browser; only the signed-in user's own subscription is removed. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const dependencies = await loadDependencies(getPushSubscriptionDependencies);
    const userId = await requireUserId(request, dependencies.authenticate);
    const endpoint = parsePushEndpoint(await jsonBody(request));
    await dependencies.subscriptions.unregister(userId, endpoint);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return pushSubscriptionErrorResponse(error);
  }
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw invalidRequest("Request body must be valid JSON");
  }
}

