import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRef, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import type { LeaveWaitlist, PreviewWithdrawal, WithdrawFromSession } from "../withdrawal-ports";
import { JoinedSessionsView, type JoinedSessionsState } from "./joined-sessions-view";
import {
  candidates, earlySession, fakeLeaveWaitlist, fakePreviewWithdrawal, fakeWithdraw, joinedSessions, lateSession, waitlistedSession,
} from "./withdrawal-fakes";

/** Holds the list like a page would, so a withdrawal or departure removes the row. Uses the fake transport. */
function JoinedSessionsHarness({ state, previewWithdrawal, withdraw, leaveWaitlist, onRetry, inviteCandidates = candidates }: {
  readonly state: JoinedSessionsState;
  readonly previewWithdrawal: PreviewWithdrawal;
  readonly withdraw: WithdrawFromSession;
  readonly leaveWaitlist: LeaveWaitlist;
  readonly onRetry: () => void;
  readonly inviteCandidates?: typeof candidates;
}) {
  const [current, setCurrent] = useState(state);
  const changed = useRef<string | null>(null);
  function track<T extends { readonly status: string }>(sessionId: string, result: T): T {
    if (result.status !== "error") changed.current = sessionId;
    return result;
  }
  return (
    <JoinedSessionsView state={current} onRetry={onRetry} actions={{
      previewWithdrawal, candidates: inviteCandidates,
      withdraw: async (request) => track(request.sessionId, await withdraw(request)),
      leaveWaitlist: async (request) => track(request.sessionId, await leaveWaitlist(request)),
      // A page reloads the list; here the changed row is removed from the fake list.
      onChanged: () => setCurrent((previous) => previous.status === "ready"
        ? { status: "ready", sessions: previous.sessions.filter((item) => item.sessionId !== changed.current) }
        : previous),
    }} />
  );
}

const meta = {
  title: "Commitments/Joined sessions",
  component: JoinedSessionsHarness,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/sessions/joined" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Joseph", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>],
  args: {
    state: { status: "ready", sessions: joinedSessions },
    previewWithdrawal: fn(fakePreviewWithdrawal),
    withdraw: fn(fakeWithdraw),
    leaveWaitlist: fn(fakeLeaveWaitlist),
    onRetry: fn(),
  },
} satisfies Meta<typeof JoinedSessionsHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () => within(document.body).getByRole("dialog");
const row = (canvas: { getAllByRole: (role: "listitem") => HTMLElement[] }, venue: string) =>
  within(canvas.getAllByRole("listitem").find((item) => item.textContent?.includes(venue))!);

/** Places held and waitlist places, each with its way out; fits a 390px phone. */
export const Joined: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    await expect(row(canvas, "Bishan Sports Hall").getByText("You have a place")).toBeVisible();
    await expect(row(canvas, "Bishan Sports Hall").getByText("S$12.50")).toBeVisible();
    await expect(row(canvas, "Jurong East Sports Hall").getByText("On the waitlist")).toBeVisible();
    await expect(row(canvas, "Jurong East Sports Hall").getByRole("button", { name: /leave the waitlist/i })).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const Loading: Story = {
  args: { state: { status: "loading" } },
  play: async ({ canvas }) => { await expect(canvas.getByText("Loading your sessions…")).toBeVisible(); },
};

export const NothingJoined: Story = {
  args: { state: { status: "ready", sessions: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("You haven't joined any sessions")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Find a session" })).toHaveAttribute("href", "/discover");
  },
};

export const LoadFailed: Story = {
  args: { state: { status: "error", message: "We couldn't load your sessions. Check your connection and try again." } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

/** More than 30 hours before the start: the refund is shown first, then the place opens to the waitlist. */
export const WithdrawWithFullRefund: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(row(canvas, "Bishan Sports Hall").getByRole("button", { name: /withdraw from/i }));
    await waitFor(() => expect(within(dialog()).getByText("S$12.50")).toBeVisible());
    const withdraw = within(dialog()).getByRole("button", { name: "Withdraw" });
    await expect(withdraw).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(withdraw);
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("S$12.50 is back in your wallet."));
    await expect(args.withdraw).toHaveBeenCalledWith(expect.objectContaining({ sessionId: earlySession.sessionId, replacement: { mode: "OPEN_SLOT" } }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(canvas.queryByText("Bishan Sports Hall")).not.toBeInTheDocument());
  },
};

/** 30 hours or less before the start: nothing comes back now; the player names one replacement. */
export const LateWithdrawalInvitingSomeone: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(row(canvas, "Kallang Tennis Centre").getByRole("button", { name: /withdraw from/i }));
    await waitFor(() => expect(within(dialog()).getByText(/stays held until\s+someone takes your place/i)).toBeVisible());
    await expect(within(dialog()).getByText("S$0.00")).toBeVisible();
    await userEvent.click(within(dialog()).getByRole("radio", { name: /invite one person/i }));
    // Choosing "invite" is not enough: a person must be picked.
    await expect(within(dialog()).getByRole("button", { name: "Withdraw" })).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole("radio", { name: "Priya Lim" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("stays held until Priya Lim accepts"));
    await expect(args.withdraw).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: lateSession.sessionId, replacement: { mode: "DIRECT_INVITE", inviteeId: candidates[1]!.userId },
    }));
  },
};

export const NoOneToInvite: Story = {
  args: { inviteCandidates: [] },
  play: async ({ canvas }) => {
    await userEvent.click(row(canvas, "Bishan Sports Hall").getByRole("button", { name: /withdraw from/i }));
    await waitFor(() => expect(within(dialog()).getByRole("radio", { name: /invite one person/i })).toBeDisabled());
    await waitFor(() => expect(within(dialog()).getByText("There's no one you can invite yet.")).toBeVisible());
  },
};

/** The refund preview failed: nothing can be withdrawn until it loads. */
let previewAttempts = 0;
export const PreviewFailedThenRetried: Story = {
  beforeEach: () => { previewAttempts = 0; },
  args: {
    previewWithdrawal: fn<PreviewWithdrawal>(async (sessionId) => {
      previewAttempts += 1;
      return previewAttempts === 1 ? { status: "error", message: "We couldn't check your refund. Please try again." } : fakePreviewWithdrawal(sessionId);
    }),
  },
  play: async ({ canvas }) => {
    await userEvent.click(row(canvas, "Bishan Sports Hall").getByRole("button", { name: /withdraw from/i }));
    await waitFor(() => expect(within(dialog()).getByText(/couldn't check your refund/i)).toBeVisible());
    await expect(within(dialog()).getByRole("button", { name: "Withdraw" })).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(dialog()).getByText("S$12.50")).toBeVisible());
  },
};

/** An unconfirmed result locks the choice and retries the exact same request, so nothing happens twice. */
let withdrawAttempts = 0;
export const UnconfirmedWithdrawalRetried: Story = {
  beforeEach: () => { withdrawAttempts = 0; },
  args: {
    withdraw: fn<WithdrawFromSession>(async (request) => {
      withdrawAttempts += 1;
      if (withdrawAttempts === 1) throw new TypeError("Failed to fetch");
      return fakeWithdraw(request);
    }),
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(row(canvas, "Bishan Sports Hall").getByRole("button", { name: /withdraw from/i }));
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByText(/couldn't confirm whether you withdrew/i)).toBeVisible());
    await expect(within(dialog()).getByRole("radio", { name: /invite one person/i })).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry withdrawal" }));
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("is back in your wallet"));
    const [first, second] = (args.withdraw as ReturnType<typeof fn<WithdrawFromSession>>).mock.calls;
    await expect(second![0]).toEqual(first![0]);
  },
};

/** A definite rejection unlocks the choice; the next attempt is a new request. */
export const WithdrawalRejected: Story = {
  args: {
    withdraw: fn<WithdrawFromSession>(async () => ({ status: "error", code: "SESSION_STARTED", message: "This session has already started, so you can't withdraw.", unconfirmed: false })),
  },
  play: async ({ canvas }) => {
    await userEvent.click(row(canvas, "Bishan Sports Hall").getByRole("button", { name: /withdraw from/i }));
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByText(/already started/i)).toBeVisible());
    await expect(within(dialog()).getByRole("radio", { name: /invite one person/i })).toBeEnabled();
    await expect(within(dialog()).getByRole("button", { name: "Withdraw" })).toBeEnabled();
  },
};

export const LeaveTheWaitlist: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(row(canvas, "Jurong East Sports Hall").getByRole("button", { name: /leave the waitlist/i }));
    await waitFor(() => expect(within(dialog()).getByText(/no money moves/i)).toBeVisible());
    await userEvent.click(within(dialog()).getByRole("button", { name: "Leave waitlist" }));
    await waitFor(() => expect(canvas.queryByText("Jurong East Sports Hall")).not.toBeInTheDocument());
    await expect(args.leaveWaitlist).toHaveBeenCalledWith(expect.objectContaining({ sessionId: waitlistedSession.sessionId }));
  },
};

/** An unconfirmed departure keeps its idempotency key for the retry. */
let leaveAttempts = 0;
export const UnconfirmedLeaveRetried: Story = {
  beforeEach: () => { leaveAttempts = 0; },
  args: {
    leaveWaitlist: fn<LeaveWaitlist>(async () => {
      leaveAttempts += 1;
      return leaveAttempts === 1
        ? { status: "error", code: "UNKNOWN_RESULT", message: "We couldn't confirm whether you left the waitlist. Please try again.", unconfirmed: true }
        : { status: "left" };
    }),
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(row(canvas, "Jurong East Sports Hall").getByRole("button", { name: /leave the waitlist/i }));
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Leave waitlist" }));
    await waitFor(() => expect(within(dialog()).getByText(/couldn't confirm whether you left/i)).toBeVisible());
    await userEvent.click(within(dialog()).getByRole("button", { name: "Leave waitlist" }));
    await waitFor(() => expect(canvas.queryByText("Jurong East Sports Hall")).not.toBeInTheDocument());
    const [first, second] = (args.leaveWaitlist as ReturnType<typeof fn<LeaveWaitlist>>).mock.calls;
    await expect(second![0].idempotencyKey).toBe(first![0].idempotencyKey);
  },
};

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => { await expect(canvas.getAllByRole("listitem")).toHaveLength(3); },
};
