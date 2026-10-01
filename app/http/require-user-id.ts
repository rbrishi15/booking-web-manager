import { z } from "zod";
import type { UUID } from "@/domain";
import { unauthenticated } from "./request-failure";

const authenticatedUserId = z.string().uuid();

/** Verify identity afresh; the supplied authenticator owns endpoint-specific account checks. */
export async function requireUserId(
  request: Request,
  authenticate: (request: Request) => Promise<UUID | null>,
): Promise<UUID> {
  const identity = await authenticate(request);
  if (identity === null) throw unauthenticated();
  return authenticatedUserId.parse(identity);
}
