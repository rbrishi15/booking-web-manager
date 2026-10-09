import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { JoinSession } from "../join-session-transport";
import { JOIN_ERROR_MESSAGES, UNCONFIRMED_JOIN_MESSAGE } from "../join-session-transport";
import { JoinSessionButton } from "./join-session-button";

const session = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  sport: "Badminton",
  venueName: "Bishan Sports Hall",
  startAt: "2045-04-02T10:00:00Z",
  bookingShareCents: 1250,
};

const meta = {
  title: "Commitments/Join session",
  component: JoinSessionButton,
  parameters: { layout: "centered" },
  args: { session, joinSession: fn<JoinSession>(async () => ({ status: "committed", heldCents: 1250 })) },
} satisfies Meta<typeof JoinSessionButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The dialog shows the amount that will be held before anything is sent. */
export const ShowsShareBeforeConfirming: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /join badminton session/i }));
    const dialog = within(document.body).getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Held from your wallet")).toBeVisible());
    await expect(within(dialog).getAllByText("S$12.50").length).toBeGreaterThan(0);
    await expect(args.joinSession).not.toHaveBeenCalled();
  },
};

export const Committed: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /join/i }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm and hold/i }));
    await waitFor(() => expect(within(dialog).getByRole("heading", { name: "You're in" })).toBeVisible());
    const [request] = (args.joinSession as ReturnType<typeof fn<JoinSession>>).mock.calls[0]!;
    await expect(request.sessionId).toBe(session.sessionId);
    await expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  },
};

export const Waitlisted: Story = {
  args: { joinSession: fn<JoinSession>(async () => ({ status: "waitlisted" })) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /join/i }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm and hold/i }));
    await waitFor(() => expect(within(dialog).getByRole("heading", { name: "You're on the waitlist" })).toBeVisible());
  },
};

export const InsufficientFunds: Story = {
  args: { joinSession: fn<JoinSession>(async () => ({ status: "error", code: "INSUFFICIENT_FUNDS", message: JOIN_ERROR_MESSAGES.INSUFFICIENT_FUNDS! })) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /join/i }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm and hold/i }));
    await waitFor(() => expect(within(dialog).getByText(/top up your wallet/i)).toBeVisible());
    await expect(within(dialog).getByRole("link", { name: "Go to wallet" })).toHaveAttribute("href", "/wallet");
  },
};

export const EmailNotVerified: Story = {
  args: { joinSession: fn<JoinSession>(async () => ({ status: "error", code: "EMAIL_VERIFICATION_REQUIRED", message: JOIN_ERROR_MESSAGES.EMAIL_VERIFICATION_REQUIRED! })) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /join/i }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm and hold/i }));
    await expect(await within(dialog).findByRole("link", { name: "Verify your email" })).toHaveAttribute("href", "/profile/email");
  },
};

export const SignedOut: Story = {
  args: { joinSession: fn<JoinSession>(async () => ({ status: "error", code: "UNAUTHENTICATED", message: JOIN_ERROR_MESSAGES.UNAUTHENTICATED! })) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /join/i }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm and hold/i }));
    await expect(await within(dialog).findByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Fdiscover");
  },
};

/** After an unconfirmed result, retrying reuses the same idempotency key, so the share can't be held twice. */
let retryAttempts = 0;
export const RetryReusesTheSameRequest: Story = {
  beforeEach: () => { retryAttempts = 0; },
  args: {
    joinSession: fn<JoinSession>(async () => {
      retryAttempts += 1;
      return retryAttempts === 1
        ? { status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_JOIN_MESSAGE }
        : { status: "committed", heldCents: 1250 };
    }),
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /join/i }));
    const dialog = within(document.body).getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm and hold/i }));
    await waitFor(() => expect(within(dialog).getByText(/couldn't confirm whether you joined/i)).toBeVisible());
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm and hold/i }));
    await waitFor(() => expect(within(dialog).getByRole("heading", { name: "You're in" })).toBeVisible());
    const calls = (args.joinSession as ReturnType<typeof fn<JoinSession>>).mock.calls;
    await expect(calls).toHaveLength(2);
    await expect(calls[1]![0].idempotencyKey).toBe(calls[0]![0].idempotencyKey);
  },
};
