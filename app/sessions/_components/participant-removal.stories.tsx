import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import type { SessionParticipantsOutcome } from "../removal-actions";
import type { SessionParticipants } from "../removal-types";
import { SessionParticipantsView } from "./session-participants-view";
import type { ParticipantRemovalTransport } from "./participant-removal-dialog";
import { participantRemovalStorageKey } from "./participant-removal-storage";

const userId = "removal-story";
const session: SessionParticipants = {
  sessionId: "20000000-0000-4000-8000-000000000001", venueName: "Bishan Sports Hall",
  sport: "Badminton", startAt: "2045-04-02T10:00:00Z", endAt: "2045-04-02T12:00:00Z",
  status: "OPEN", availableSlots: 0, canVerifyAttendance: false,
  participants: [
    { participationId: "30000000-0000-4000-8000-000000000001", displayName: "Alex Tan", status: "COMMITTED", attendance: "UNVERIFIED", canRemove: true },
    { participationId: "30000000-0000-4000-8000-000000000002", displayName: "Priya Lim", status: "WAITLISTED", attendance: "UNVERIFIED", canRemove: false },
    { participationId: "30000000-0000-4000-8000-000000000003", displayName: "Sam Lee", status: "WITHDRAWN", attendance: "UNVERIFIED", canRemove: false },
    { participationId: "30000000-0000-4000-8000-000000000004", displayName: "Taylor Chan", status: "REMOVED", attendance: "UNVERIFIED", canRemove: false },
  ],
};
const participationId = session.participants[0]!.participationId;
const preview = { sessionId: session.sessionId, participationId, refundCents: 750, previewVersion: "a".repeat(64) };
const result = { sessionId: session.sessionId, participationId, status: "REMOVED" as const, refundCents: 750 };
const storageKey = participantRemovalStorageKey(userId, session.sessionId);
const savedRequest = { ...preview, userId, displayName: "Alex Tan", idempotencyKey: "40000000-0000-4000-8000-000000000001" };

function Harness({ outcome, preview: loadPreview, remove }: Omit<ParticipantRemovalTransport, "userId"> & { readonly outcome: SessionParticipantsOutcome }) {
  const [mount, setMount] = useState(0);
  const [refreshes, setRefreshes] = useState(0);
  return <>
    <SessionParticipantsView key={mount} sessionId={session.sessionId} outcome={outcome} refreshing={false}
      removal={{ userId, preview: loadPreview, remove }} onRefresh={() => setRefreshes((value) => value + 1)} />
    <div className="px-6 pb-6"><Button variant="outline" onClick={() => setMount((value) => value + 1)}>Simulate reload</Button>
      <span className="sr-only">Server refreshes: {refreshes}</span></div>
  </>;
}

const meta = {
  title: "Sessions/Participant removal", component: Harness,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "phone", isRotated: false } },
  beforeEach: () => {
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(participantRemovalStorageKey("another-host", session.sessionId));
  },
  args: {
    outcome: { status: "ready", session },
    preview: fn<ParticipantRemovalTransport["preview"]>(async () => ({ status: "ready", preview })),
    remove: fn<ParticipantRemovalTransport["remove"]>(async () => ({ status: "removed", result })),
  },
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openRemoval(canvas: ReturnType<typeof within>) {
  const trigger = canvas.getByRole("button", { name: "Remove Alex Tan" });
  await waitFor(() => expect(trigger).toBeEnabled());
  await userEvent.click(trigger);
  const dialog = within(document.body).getByRole("dialog");
  await waitFor(() => expect(within(dialog).getByText("Wallet refund")).toBeVisible());
  return within(dialog);
}

export const ConfirmHistoricalRefund: Story = {
  play: async ({ canvas, args }) => {
    const list = canvas.getByRole("list", { name: "Participants" });
    await expect(within(list).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Alex Tan", "Priya Lim", "Sam Lee", "Taylor Chan"]);
    await expect(within(list).getAllByRole("button")).toHaveLength(1);
    const dialog = await openRemoval(canvas);
    await expect(dialog.getByText(/Removal prevents them from rejoining/)).toHaveTextContent("Alex Tan");
    await expect(dialog.getByText(/7.50/)).toBeVisible();
    await expect(args.remove).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Alex Tan removed"));
    await expect(canvas.getByText("1 slot available")).toBeVisible();
    await expect(within(canvas.getByRole("article", { name: "Alex Tan" })).getByText("Removed")).toBeVisible();
    await expect(canvas.getByText("Waitlisted")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Remove Alex Tan" })).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole("heading", { name: "Manage participants" })).toHaveFocus());
    await expect(args.remove).toHaveBeenCalledOnce();
    await expect(sessionStorage.getItem(storageKey)).toBeNull();
  },
};

export const KeyboardDismissal: Story = {
  play: async ({ canvas, args }) => {
    const trigger = canvas.getByRole("button", { name: "Remove Alex Tan" });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = within(within(document.body).getByRole("dialog"));
    await waitFor(() => expect(dialog.getByText("Wallet refund")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(args.remove).not.toHaveBeenCalled();
  },
};

export const PreviewUnavailable: Story = {
  args: { preview: fn<ParticipantRemovalTransport["preview"]>(async () => ({ status: "error", code: "INTERNAL_ERROR", message: "We couldn't load the refund.", refresh: false, retrySameRequest: true })) },
  play: async ({ canvas, args }) => {
    const trigger = canvas.getByRole("button", { name: "Remove Alex Tan" });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const dialog = within(within(document.body).getByRole("dialog"));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("We couldn't load the refund");
    await expect(dialog.getByRole("button", { name: "Confirm removal" })).toBeDisabled();
    await userEvent.click(dialog.getByRole("button", { name: "Retry preview" }));
    await waitFor(() => expect(args.preview).toHaveBeenCalledTimes(2));
    await expect(args.remove).not.toHaveBeenCalled();
  },
};

export const AmbiguousResultAndReload: Story = {
  args: { remove: fn<ParticipantRemovalTransport["remove"]>(async () => { throw new Error("Lost response"); }) },
  play: async ({ canvas, args }) => {
    const dialog = await openRemoval(canvas);
    await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Retry this removal using the saved request");
    const original = JSON.parse(sessionStorage.getItem(storageKey)!);
    await userEvent.click(dialog.getByRole("button", { name: "Close for now" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).not.toBeInTheDocument());
    await expect(canvas.getByRole("button", { name: "Check removal result" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Simulate reload" }));
    const restored = within(await within(document.body).findByRole("dialog"));
    await expect(restored.getByRole("heading")).toHaveTextContent("Check removal result");
    await waitFor(() => expect(restored.getByText(/7.50/)).toBeVisible());
    await userEvent.click(restored.getByRole("button", { name: "Retry removal" }));
    await waitFor(() => expect(args.remove).toHaveBeenCalledTimes(2));
    await expect(args.remove.mock.calls[1]).toEqual(args.remove.mock.calls[0]);
    await expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(original);
    await expect(args.preview).toHaveBeenCalledOnce();
  },
};

export const ExpiredLoginRetainsOriginal: Story = {
  args: { remove: fn<ParticipantRemovalTransport["remove"]>(async () => ({ status: "error", code: "UNAUTHENTICATED", message: "Sign in again before retrying the saved request.", refresh: false, retrySameRequest: false })) },
  play: async ({ canvas, args }) => {
    const dialog = await openRemoval(canvas);
    await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Sign in again");
    const original = sessionStorage.getItem(storageKey);
    await expect(original).not.toBeNull();
    await userEvent.click(dialog.getByRole("button", { name: "Retry removal" }));
    await expect(args.remove.mock.calls[1]).toEqual(args.remove.mock.calls[0]);
    await expect(sessionStorage.getItem(storageKey)).toBe(original);
  },
};

export const AuthorityFailuresRetainUnknownResult: Story = {
  play: async ({ canvas, args }) => {
    args.remove.mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce({ status: "error", code: "UNAUTHORIZED", message: "Authority could not be verified.", refresh: false, retrySameRequest: false })
      .mockResolvedValueOnce({ status: "error", code: "NOT_FOUND", message: "Account was not found.", refresh: false, retrySameRequest: false })
      .mockResolvedValue({ status: "removed", result });
    const dialog = await openRemoval(canvas);
    await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Retry this removal using the saved request");
    const original = sessionStorage.getItem(storageKey);
    await expect(original).not.toBeNull();
    for (const message of ["Authority could not be verified", "Account was not found"]) {
      await userEvent.click(dialog.getByRole("button", { name: "Retry removal" }));
      await waitFor(() => expect(dialog.getByRole("alert")).toHaveTextContent(message));
      await expect(sessionStorage.getItem(storageKey)).toBe(original);
    }
    await expect(args.preview).toHaveBeenCalledOnce();
    await userEvent.click(dialog.getByRole("button", { name: "Retry removal" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Alex Tan removed"));
    await expect(args.remove).toHaveBeenCalledTimes(4);
    for (const call of args.remove.mock.calls) await expect(call).toEqual(args.remove.mock.calls[0]);
    await expect(sessionStorage.getItem(storageKey)).toBeNull();
  },
};

export const DefinitiveFirstAttemptFailure: Story = {
  args: { remove: fn<ParticipantRemovalTransport["remove"]>(async () => ({ status: "error", code: "UNAUTHORIZED", message: "Only the host can remove participants.", refresh: false, retrySameRequest: false })) },
  play: async ({ canvas, args }) => {
    const dialog = await openRemoval(canvas);
    await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Only the host");
    await expect(sessionStorage.getItem(storageKey)).toBeNull();
    await expect(args.remove).toHaveBeenCalledOnce();
    await expect(dialog.queryByRole("button", { name: "Retry removal" })).not.toBeInTheDocument();
  },
};

export const ChangedPreview: Story = {
  play: async ({ canvas, args }) => {
    args.preview.mockResolvedValueOnce({ status: "ready", preview }).mockResolvedValue({ status: "ready", preview: { ...preview, previewVersion: "b".repeat(64), refundCents: 900 } });
    args.remove.mockResolvedValueOnce({ status: "error", code: "STALE_REMOVAL_PREVIEW", message: "The participant changed. Review the updated refund.", refresh: true, retrySameRequest: false })
      .mockResolvedValue({ status: "removed", result: { ...result, refundCents: 900 } });
    const dialog = await openRemoval(canvas);
    await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(dialog.getByText(/9.00/)).toBeVisible());
    await expect(args.remove).toHaveBeenCalledOnce();
    await expect(sessionStorage.getItem(storageKey)).toBeNull();
    await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("9.00"));
    await expect(args.remove.mock.calls[0]![2].idempotencyKey).not.toBe(args.remove.mock.calls[1]![2].idempotencyKey);
    await expect(args.remove.mock.calls[1]![2].previewVersion).toBe("b".repeat(64));
  },
};

export const PreventDuplicateSubmission: Story = {
  play: async ({ canvas, args }) => {
    let complete!: (value: Awaited<ReturnType<ParticipantRemovalTransport["remove"]>>) => void;
    args.remove.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const dialog = await openRemoval(canvas);
    await userEvent.dblClick(dialog.getByRole("button", { name: "Confirm removal" }));
    await expect(args.remove).toHaveBeenCalledOnce();
    await expect(dialog.getByRole("button", { name: "Removing…" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(within(document.body).getByRole("dialog")).toBeVisible();
    complete({ status: "removed", result });
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Alex Tan removed"));
  },
};

export const SavedRequestAfterParticipantRemoved: Story = {
  beforeEach: () => { sessionStorage.setItem(storageKey, JSON.stringify(savedRequest)); },
  args: { outcome: { status: "ready", session: { ...session, availableSlots: 1, participants: session.participants.map((participant) => participant.participationId === participationId ? { ...participant, status: "REMOVED", attendance: "UNVERIFIED", canRemove: false } : participant) } } },
  play: async ({ canvas, args }) => {
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Retry removal" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Alex Tan removed"));
    await expect(canvas.getByText("1 slot available")).toBeVisible();
    await expect(args.preview).not.toHaveBeenCalled();
    await expect(args.remove).toHaveBeenCalledWith(session.sessionId, participationId, { idempotencyKey: savedRequest.idempotencyKey, previewVersion: savedRequest.previewVersion });
  },
};

export const CorruptRecoveryIsPreserved: Story = {
  beforeEach: () => { sessionStorage.setItem(storageKey, "{incomplete"); },
  play: async ({ canvas, args }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("saved removal request could not be read safely");
    await expect(canvas.getByRole("button", { name: "Remove Alex Tan" })).toBeDisabled();
    await expect(sessionStorage.getItem(storageKey)).toBe("{incomplete");
    await expect(args.preview).not.toHaveBeenCalled();
    await expect(args.remove).not.toHaveBeenCalled();
  },
};

export const CorruptPreviewVersionIsPreserved: Story = {
  beforeEach: () => { sessionStorage.setItem(storageKey, JSON.stringify({ ...savedRequest, previewVersion: "bad" })); },
  play: async ({ canvas, args }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("saved removal request could not be read safely");
    await expect(canvas.getByRole("button", { name: "Remove Alex Tan" })).toBeDisabled();
    await expect(JSON.parse(sessionStorage.getItem(storageKey)!).previewVersion).toBe("bad");
    await expect(args.preview).not.toHaveBeenCalled();
    await expect(args.remove).not.toHaveBeenCalled();
  },
};

export const WrongUserRecoveryIsPreserved: Story = {
  beforeEach: () => { sessionStorage.setItem(storageKey, JSON.stringify({ ...savedRequest, userId: "another-host", displayName: "Private name" })); },
  play: async ({ canvas, args }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("saved removal request could not be read safely");
    await expect(canvas.queryByText("Private name")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Remove Alex Tan" })).toBeDisabled();
    await expect(JSON.parse(sessionStorage.getItem(storageKey)!).userId).toBe("another-host");
    await expect(args.remove).not.toHaveBeenCalled();
  },
};

export const OtherHostRequestStaysIsolated: Story = {
  beforeEach: () => { sessionStorage.setItem(participantRemovalStorageKey("another-host", session.sessionId), JSON.stringify({ ...savedRequest, userId: "another-host" })); },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole("button", { name: "Remove Alex Tan" })).toBeEnabled());
    await expect(within(document.body).queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const StorageFailurePreventsSubmission: Story = {
  play: async ({ canvas, args }) => {
    const dialog = await openRemoval(canvas);
    const originalSetItem = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
      await userEvent.click(dialog.getByRole("button", { name: "Confirm removal" }));
      await expect(await dialog.findByRole("alert")).toHaveTextContent("removal was not sent");
      await expect(args.remove).not.toHaveBeenCalled();
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
    await userEvent.click(dialog.getByRole("button", { name: "Retry removal" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Alex Tan removed"));
    await expect(args.remove).toHaveBeenCalledOnce();
  },
};

export const StartedSession: Story = {
  args: { outcome: { status: "ready", session: { ...session, startAt: "2020-04-02T10:00:00Z", endAt: "2020-04-02T12:00:00Z", participants: session.participants.map((participant) => ({ ...participant, canRemove: false })) } } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: "Remove Alex Tan" })).not.toBeInTheDocument();
    await expect(canvas.getByText("Committed")).toBeVisible();
  },
};

export const EmptyRoster: Story = { args: { outcome: { status: "ready", session: { ...session, availableSlots: 8, participants: [] } } } };
export const Unavailable: Story = { args: { outcome: { status: "error", code: "SESSION_REMOVAL_UNAVAILABLE", message: "Participant management is temporarily unavailable.", refresh: false, retrySameRequest: true } } };
export const Desktop: Story = { globals: { viewport: { value: "desktop", isRotated: false } } };

/** UC2-06: once an open session has ended, the booker sees the attendance check above the list. */
export const AttendanceCheckOpen: Story = {
  args: { outcome: { status: "ready", session: { ...session, canVerifyAttendance: true } } },
  play: async ({ canvas }) => {
    const form = within(canvas.getByRole("region", { name: "Check attendance" }));
    await expect(form.getByRole("group", { name: "Alex Tan" })).toBeVisible();
    await expect(form.queryByRole("group", { name: "Priya Lim" })).not.toBeInTheDocument();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const AttendanceAlreadyMarked: Story = {
  args: { outcome: { status: "ready", session: { ...session, canVerifyAttendance: true, participants: session.participants.map((participant) =>
    participant.status === "COMMITTED" ? { ...participant, attendance: "ABSENT" as const, canRemove: false } : participant) } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Committed · Absent/)).toBeVisible();
    await expect(within(canvas.getByRole("region", { name: "Check attendance" })).queryByRole("group")).not.toBeInTheDocument();
  },
};
