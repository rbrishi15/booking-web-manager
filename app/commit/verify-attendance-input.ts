import type { UUID } from "@/domain";
import type { VerifyAttendanceRequest } from "@/use-cases/sessions/VerifyAttendance";
import { z } from "zod";
import { idempotencyKey, uuid } from "./http";

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

/**
 * UC2-06 booker verification: `{ sessionId, idempotencyKey, marks }`. The
 * domain rejects anyone but the session's booker and any verification before
 * the session ends. Verification moves no money; it makes shares payable.
 */
export function parseVerifyAttendanceInput(
  userId: UUID,
  body: unknown,
): VerifyAttendanceRequest {
  return { userId, ...verifyRequest.parse(body) };
}
