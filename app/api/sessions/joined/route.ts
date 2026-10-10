import { commitmentQuery } from "@/app/commit/commitment-action";
import { toJoinedSessionsResponse } from "@/app/commit/joined-sessions-response";

export const runtime = "nodejs";

/** UC2-05: the sessions the authenticated user holds a place in or is waiting for. */
export const GET = commitmentQuery({
  run: async (dependencies, userId) => toJoinedSessionsResponse(await dependencies.listJoinedSessions.forParticipant(userId)),
});
