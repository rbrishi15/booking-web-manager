import { z } from "zod";
import { userLookupGetAction } from "@/app/users/user-lookup-action";
import { toUserLookupResponse } from "@/app/users/user-lookup-response";

export const runtime = "nodejs";

/** ADR-0021: a signed-in player finds an active player by their exact user ID. */
export const GET = userLookupGetAction({
  parse: (_userId, params) => z.string().max(64).parse(params.handle),
  invalidRequestMessage: "The user ID is too long",
  run: (dependencies, handle) => dependencies.findUserByHandle.forHandle(handle),
  serialize: toUserLookupResponse,
});
