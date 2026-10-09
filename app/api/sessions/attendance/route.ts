import { commitmentAction } from "@/app/commit/commitment-action";
import { parseVerifyAttendanceInput } from "@/app/commit/verify-attendance-input";

export const runtime = "nodejs";

/** UC2-06: the booker marks attendance after the session ends. */
export const POST = commitmentAction({
  parse: parseVerifyAttendanceInput,
  run: (dependencies, input) => dependencies.verifyAttendance.forBooker(input),
  invalidRequestMessage: "Invalid attendance verification request",
});
