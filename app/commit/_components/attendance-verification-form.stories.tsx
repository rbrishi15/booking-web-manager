import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { ATTENDANCE_ERROR_MESSAGES, UNCONFIRMED_ATTENDANCE_MESSAGE, type VerifyAttendance } from "../verify-attendance-transport";
import { AttendanceVerificationForm } from "./attendance-verification-form";

const sessionId = "11111111-1111-4111-8111-111111111111";
const players = [
  { participationId: "22222222-2222-4222-8222-222222222222", displayName: "Alex Tan" },
  { participationId: "33333333-3333-4333-8333-333333333333", displayName: "Priya Lim" },
];

const meta = {
  title: "Commitments/Verify attendance",
  component: AttendanceVerificationForm,
  parameters: { layout: "padded" },
  globals: { viewport: { value: "phone", isRotated: false } },
  args: { sessionId, players, onSaved: fn(), verifyAttendance: fn<VerifyAttendance>(async () => ({ status: "saved", allVerified: true })) },
} satisfies Meta<typeof AttendanceVerificationForm>;

export default meta;
type Story = StoryObj<typeof meta>;

function calls(mock: unknown) {
  return (mock as ReturnType<typeof fn<VerifyAttendance>>).mock.calls;
}

async function mark(canvasElement: HTMLElement, player: string, choice: "Attended" | "Absent") {
  const group = within(canvasElement).getByRole("group", { name: player });
  await userEvent.click(within(group).getByRole("radio", { name: choice }));
}

async function saveAndConfirm(canvasElement: HTMLElement, confirmName: RegExp = /^save attendance$/i) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /save attendance|retry saving attendance/i }));
  const dialog = within(document.body).getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: confirmName }));
  return dialog;
}

/** Nothing can be saved until at least one player is marked. */
export const NothingMarkedYet: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Save attendance (0)" })).toBeDisabled();
  },
};

/** The confirmation summarises the marks before the irreversible save, then sends them in one request. */
export const SavesMarks: Story = {
  play: async ({ args, canvasElement }) => {
    await mark(canvasElement, "Alex Tan", "Attended");
    await mark(canvasElement, "Priya Lim", "Absent");
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Save attendance (2)" }));
    const dialog = within(document.body).getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/1 attended, 1 absent/)).toBeVisible());
    await userEvent.click(within(dialog).getByRole("button", { name: /^save attendance$/i }));
    await waitFor(() => expect(within(canvasElement).getByText(/every player is now checked/i)).toBeVisible());
    const [request] = calls(args.verifyAttendance)[0]!;
    await expect(request.sessionId).toBe(sessionId);
    await expect(request.marks).toEqual([
      { participationId: players[0]!.participationId, attendance: "ATTENDED" },
      { participationId: players[1]!.participationId, attendance: "ABSENT" },
    ]);
    await expect(args.onSaved).toHaveBeenCalledOnce();
  },
};

/** Only the players who were marked are sent; the rest auto-verify later. */
export const SavesOnlyMarkedPlayers: Story = {
  args: { verifyAttendance: fn<VerifyAttendance>(async () => ({ status: "saved", allVerified: false })) },
  play: async ({ args, canvasElement }) => {
    await mark(canvasElement, "Priya Lim", "Absent");
    await saveAndConfirm(canvasElement);
    await waitFor(() => expect(within(canvasElement).getByText("Attendance saved.")).toBeVisible());
    await expect(calls(args.verifyAttendance)[0]![0].marks).toEqual([{ participationId: players[1]!.participationId, attendance: "ABSENT" }]);
  },
};

export const AlreadyMarkedElsewhere: Story = {
  args: { verifyAttendance: fn<VerifyAttendance>(async () => ({ status: "error", code: "ATTENDANCE_CONFLICT", message: ATTENDANCE_ERROR_MESSAGES.ATTENDANCE_CONFLICT!, unconfirmed: false })) },
  play: async ({ args, canvasElement }) => {
    await mark(canvasElement, "Alex Tan", "Attended");
    const dialog = await saveAndConfirm(canvasElement);
    await waitFor(() => expect(within(dialog).getByText(/already marked/i)).toBeVisible());
    await expect(args.onSaved).not.toHaveBeenCalled();
  },
};

/** After an unconfirmed result the choices lock and the retry sends the identical request. */
let attempts = 0;
export const RetryReusesTheSameRequest: Story = {
  beforeEach: () => { attempts = 0; },
  args: {
    verifyAttendance: fn<VerifyAttendance>(async () => {
      attempts += 1;
      return attempts === 1
        ? { status: "error", code: "INTERNAL_ERROR", message: UNCONFIRMED_ATTENDANCE_MESSAGE, unconfirmed: true }
        : { status: "saved", allVerified: true };
    }),
  },
  play: async ({ args, canvasElement }) => {
    await mark(canvasElement, "Alex Tan", "Attended");
    const dialog = await saveAndConfirm(canvasElement);
    await waitFor(() => expect(within(dialog).getByText(/couldn't confirm whether attendance was saved/i)).toBeVisible());
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).not.toBeInTheDocument());

    // The choices are locked so the retry cannot change the marks.
    for (const radio of within(canvasElement).getAllByRole("radio")) await expect(radio).toBeDisabled();
    await saveAndConfirm(canvasElement, /^retry saving$/i);
    await waitFor(() => expect(within(canvasElement).getByText(/every player is now checked/i)).toBeVisible());
    const [first, second] = calls(args.verifyAttendance).map(([request]) => request);
    await expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
    await expect(second!.marks).toEqual(first!.marks);
  },
};
