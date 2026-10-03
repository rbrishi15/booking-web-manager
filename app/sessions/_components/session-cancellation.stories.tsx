import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { CancellationOutcome, CancellationPreviewOutcome } from "../cancellation-actions";
import type { HostedSessionItem } from "../types";
import { HostedSessionsView } from "./hosted-sessions-view";
import type { CancellationTransport } from "./session-cancellation-dialog";
import { getSessionAccountActions, toHostedSessionActions, withCancellationAction } from "../session-actions";

const session: HostedSessionItem = {
  sessionId: "20000000-0000-4000-8000-000000000001", venueName: "Bishan Sports Hall",
  sport: "Badminton", region: "Central", startAt: "2045-04-02T10:00:00Z",
  endAt: "2045-04-02T12:00:00Z", visibility: "PUBLIC", availableSlots: 0,
  actions: toHostedSessionActions("20000000-0000-4000-8000-000000000001", [{ name: "preview-cancellation" }]),
};
const preview = withCancellationAction({ sessionId: session.sessionId, affectedParticipantCount: 3, refundRecipientCount: 2, totalRefundCents: 1000, previewVersion: "a".repeat(64) });
const result = { sessionId: session.sessionId, status: "CANCELLED" as const, refundRecipientCount: 2, totalRefundCents: 1000 };

function Harness({ preview: loadPreview, cancel }: Omit<CancellationTransport, "userId">) {
  const [sessions, setSessions] = useState<readonly HostedSessionItem[]>([session]);
  return <HostedSessionsView outcome={{ status: "ready", sessions }} refreshing={false}
    actions={getSessionAccountActions({ accountStatus: "ACTIVE", email: "host@example.com", emailVerified: true })}
    onSetVisibility={async () => ({ status: "error", code: "CAPACITY_EXCEEDED", message: "Full", refresh: true })}
    cancellation={{ userId: "cancellation-story", preview: loadPreview, cancel }}
    onRefresh={() => setSessions([])} />;
}
const meta = {
  title: "Sessions/Cancellation", component: Harness,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "phone", isRotated: false } },
  beforeEach: () => { sessionStorage.removeItem("session-cancellation:cancellation-story"); },
  args: {
    preview: fn<CancellationTransport["preview"]>(async () => ({ status: "ready", preview })),
    cancel: fn<CancellationTransport["cancel"]>(async () => ({ status: "cancelled", result })),
  },
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmRefunds: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.queryByRole("button", { name: "Make private" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel session" }));
    const dialog = within(document.body).getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Total wallet refunds")).toBeVisible());
    await expect(dialog).toHaveTextContent("10.00");
    await expect(dialog).toHaveTextContent("3 participants are affected");
    await expect(dialog).toHaveTextContent("2 participants will receive a refund");
    await expect(args.cancel).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Session cancelled"));
    await waitFor(() => expect(canvas.getByText("No upcoming sessions to manage")).toBeVisible());
    await expect(args.cancel).toHaveBeenCalledOnce();
    await expect(sessionStorage.getItem("session-cancellation:cancellation-story")).toBeNull();
  },
};
export const ZeroRefund: Story = {
  args: { preview: fn<CancellationTransport["preview"]>(async (): Promise<CancellationPreviewOutcome> => ({ status: "ready", preview: { ...preview, affectedParticipantCount: 0, refundRecipientCount: 0, totalRefundCents: 0 } })) },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Cancel session" }));
    const dialog = within(document.body).getByRole("dialog");
    await expect(dialog).toHaveTextContent("0.00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep session" }));
    await expect(args.cancel).not.toHaveBeenCalled();
  },
};
export const PreviewUnavailable: Story = {
  args: { preview: fn<CancellationTransport["preview"]>(async (): Promise<CancellationPreviewOutcome> => ({ status: "error", code: "INTERNAL_ERROR", message: "We couldn't load the refunds.", refresh: false, retrySameRequest: true })) },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Cancel session" }));
    const dialog = within(document.body).getByRole("dialog");
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("We couldn't load the refunds.");
    await expect(within(dialog).getByRole("button", { name: "Confirm cancellation" })).toBeDisabled();
    await expect(within(dialog).getByRole("button", { name: "Retry preview" })).toBeEnabled();
  },
};
export const AmbiguousResponse: Story = {
  args: { cancel: fn<CancellationTransport["cancel"]>(async (): Promise<CancellationOutcome> => { throw new Error("Lost response"); }) },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Cancel session" }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Retry this cancellation");
    const first = JSON.parse(sessionStorage.getItem("session-cancellation:cancellation-story")!);
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry cancellation" }));
    await expect(args.cancel).toHaveBeenCalledTimes(2);
    await expect(JSON.parse(sessionStorage.getItem("session-cancellation:cancellation-story")!)).toEqual(first);
  },
};

export const ExpiredIdentityDuringRecovery: Story = {
  play: async ({ canvas, args }) => {
    args.cancel
      .mockResolvedValueOnce({ status: "error", code: "UNKNOWN_RESULT", message: "The response was lost. Retry this cancellation.", refresh: true, retrySameRequest: true })
      .mockResolvedValueOnce({ status: "error", code: "UNAUTHENTICATED", message: "Your sign-in has expired. Sign in again to continue.", refresh: false, retrySameRequest: true })
      .mockResolvedValue({ status: "cancelled", result });
    await userEvent.click(canvas.getByRole("button", { name: "Cancel session" }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(canvas.getByText("No upcoming sessions to manage")).toBeVisible());
    const original = sessionStorage.getItem("session-cancellation:cancellation-story");
    await expect(original).not.toBeNull();

    await userEvent.click(within(dialog).getByRole("button", { name: "Retry cancellation" }));
    await waitFor(() => expect(within(dialog).getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login?next=%2Fsessions"));
    await expect(sessionStorage.getItem("session-cancellation:cancellation-story")).toBe(original);

    await userEvent.click(within(dialog).getByRole("button", { name: "Retry cancellation" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Session cancelled"));
    await expect(args.cancel).toHaveBeenCalledTimes(3);
    await expect(args.cancel.mock.calls[0]![1]).toEqual(args.cancel.mock.calls[1]![1]);
    await expect(args.cancel.mock.calls[0]![1]).toEqual(args.cancel.mock.calls[2]![1]);
    await expect(sessionStorage.getItem("session-cancellation:cancellation-story")).toBeNull();
  },
};
export const Desktop: Story = { globals: { viewport: { value: "desktop", isRotated: false } } };

export const ChangedPreview: Story = {
  play: async ({ canvas, args }) => {
    args.preview
      .mockResolvedValueOnce({ status: "ready", preview: { ...preview, totalRefundCents: 500 } })
      .mockResolvedValue({ status: "ready", preview: withCancellationAction({ ...preview, previewVersion: "b".repeat(64) }) });
    args.cancel
      .mockResolvedValueOnce({ status: "error", code: "STALE_CANCELLATION_PREVIEW", message: "The session changed. Review the updated refunds before confirming.", refresh: true, retrySameRequest: false })
      .mockResolvedValue({ status: "cancelled", result });
    await userEvent.click(canvas.getByRole("button", { name: "Cancel session" }));
    const dialog = within(document.body).getByRole("dialog");
    await expect(dialog).toHaveTextContent("5.00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(dialog).toHaveTextContent("10.00"));
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("The session changed");
    await expect(args.cancel).toHaveBeenCalledOnce();
    await expect(sessionStorage.getItem("session-cancellation:cancellation-story")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Session cancelled"));
    const calls = args.cancel.mock.calls;
    await expect(calls[0]![1].idempotencyKey).not.toBe(calls[1]![1].idempotencyKey);
    await expect(calls[1]![1].previewVersion).toBe("b".repeat(64));
  },
};
