import type { VerifyAttendance } from "@/use-cases/sessions/VerifyAttendance";
import { z } from "zod";
import {
  type Authenticate,
  handleAuthenticatedJson,
  idempotencyKey,
  uuid,
} from "./http";

const verifyRequest = z.object({
  sessionId: uuid,
  idempotencyKey,
  marks: z
    .array(
      z.object({
        participationId: uuid,
        attendance: z.enum(["ATTENDED", "ABSENT"]),
      }),
    )
    .min(1),
});

export interface VerifyAttendanceHttpDependencies {
  readonly authenticate: Authenticate;
  readonly verifyAttendance: Pick<VerifyAttendance, "forBooker">;
}

/**
 * UC2-06 booker verification: `{ sessionId, idempotencyKey, marks }`. The
 * domain rejects anyone but the session's booker and any verification before
 * the session ends. Verification moves no money; it makes shares payable.
 */
export function handleVerifyAttendance(
  request: Request,
  dependencies: VerifyAttendanceHttpDependencies,
): Promise<Response> {
  return handleAuthenticatedJson(request, {
    authenticate: dependencies.authenticate,
    parse: (userId, body) => ({ userId, ...verifyRequest.parse(body) }),
    run: (input) => dependencies.verifyAttendance.forBooker(input),
    successStatus: 200,
    invalidRequestMessage: "Invalid attendance verification request",
  });
}
