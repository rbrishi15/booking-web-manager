import { z } from "zod";
import { sessionEditingActions } from "@/app/sessions/editing-action";
import { sessionEditRequestSchema } from "@/app/sessions/editing-contract";

export const runtime = "nodejs";
const id = z.string().uuid();

export const GET = sessionEditingActions.get({
  parse: (bookerId, params) => ({ bookerId, sessionId: id.parse(params.sessionId) }),
  run: (dependencies, input) => dependencies.editSession.detailsForBooker(input.bookerId, input.sessionId),
});

export const PATCH = sessionEditingActions.json({
  parse: (bookerId, body, params) => ({ bookerId, sessionId: id.parse(params.sessionId), input: sessionEditRequestSchema.parse(body) }),
  run: (dependencies, input) => dependencies.editSession.forBooker(input.bookerId, input.sessionId, input.input),
  invalidRequestMessage: "Invalid session editing request",
});
