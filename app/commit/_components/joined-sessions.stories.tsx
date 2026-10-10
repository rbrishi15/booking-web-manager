import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { focusManager, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { useLeaveWaitlistFlow } from "../use-leave-waitlist-flow";
import { useWithdrawalFlow } from "../use-withdrawal-flow";
import type { LeaveWaitlist, LoadJoinedSessions, PreviewWithdrawal, WithdrawFromSession } from "../withdrawal-ports";
import { joinedSessionsQueryKey } from "../withdrawal-query-keys";
import { memoryUnresolvedStore, type UnresolvedStore, type UnresolvedWithdrawal } from "../withdrawal-recovery";
import { JoinedSessionsView, type JoinedSessionsState } from "./joined-sessions-view";
import { LeaveWaitlistDialog } from "./leave-waitlist-dialog";
import { WithdrawalDialog } from "./withdrawal-dialog";
import {
  candidates, earlySession, fakeLeaveWaitlist, fakeLoadJoinedSessions, fakePreviewWithdrawal, fakeWithdraw, lateSession, waitlistedSession,
} from "./withdrawal-fakes";

const userId = "99999999-9999-4999-8999-999999999999";

/**
 * What the page will render, as its composition root: React Query loads the list (and refreshes
 * it after a withdrawal or departure), the flow hooks hold the interaction state, and the
 * presentational list and dialogs display it. Here the transport is fake and unresolved requests
 * are kept in memory; a session the fake withdraws or removes drops out of the next list load.
 */
function JoinedSessionsPageHarness({ loadJoinedSessions, previewWithdrawal, withdraw, leaveWaitlist, inviteCandidates = candidates, withdrawalStore, departureStore }: {
  readonly loadJoinedSessions: LoadJoinedSessions;
  readonly previewWithdrawal: PreviewWithdrawal;
  readonly withdraw: WithdrawFromSession;
  readonly leaveWaitlist: LeaveWaitlist;
  readonly inviteCandidates?: typeof candidates;
  readonly withdrawalStore?: UnresolvedStore<UnresolvedWithdrawal>;
  readonly departureStore?: UnresolvedStore<string>;
}) {
  const gone = useRef(new Set<string>());
  function track<T extends { readonly status: string }>(sessionId: string, result: T): T {
    if (result.status !== "error") gone.current.add(sessionId);
    return result;
  }
  const list = useQuery({
    queryKey: joinedSessionsQueryKey(userId),
    queryFn: async () => (await loadJoinedSessions()).filter((session) => !gone.current.has(session.sessionId)),
    retry: false,
  });
  const [stores] = useState(() => ({ withdrawals: withdrawalStore ?? memoryUnresolvedStore(), departures: departureStore ?? memoryUnresolvedStore<string>() }));
  const [transports] = useState(() => ({
    previewWithdrawal,
    withdraw: (async (request) => track(request.sessionId, await withdraw(request))) satisfies WithdrawFromSession,
    leaveWaitlist: (async (request) => track(request.sessionId, await leaveWaitlist(request))) satisfies LeaveWaitlist,
  }));
  const withdrawal = useWithdrawalFlow({ userId, sessions: list.data, store: stores.withdrawals, previewWithdrawal: transports.previewWithdrawal, withdraw: transports.withdraw });
  const leaving = useLeaveWaitlistFlow({ userId, sessions: list.data, store: stores.departures, leaveWaitlist: transports.leaveWaitlist });
  const state: JoinedSessionsState = list.isPending ? { status: "loading" }
    : list.isError ? { status: "error", message: "We couldn't load your sessions. Check your connection and try again." }
    : { status: "ready", sessions: list.data };
  return (
    <>
      <JoinedSessionsView state={state} onRetry={() => { void list.refetch(); }} onWithdraw={withdrawal.start} onLeaveWaitlist={leaving.start} />
      <WithdrawalDialog state={withdrawal.state} candidates={inviteCandidates} onChooseMode={withdrawal.chooseMode}
        onChooseInvitee={withdrawal.chooseInvitee} onConfirm={withdrawal.confirm} onRetryPreview={withdrawal.retryPreview} onClose={withdrawal.close} />
      <LeaveWaitlistDialog state={leaving.state} onConfirm={leaving.confirm} onClose={leaving.close} />
    </>
  );
}

const meta = {
  title: "Commitments/Joined sessions",
  component: JoinedSessionsPageHarness,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/sessions/joined" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => {
    // A fresh cache per story, as each browser tab gets in the app.
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return (
      <QueryClientProvider client={client}>
        <AppShell user={{ name: "Joseph", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>
      </QueryClientProvider>
    );
  }],
  args: {
    loadJoinedSessions: fn(fakeLoadJoinedSessions),
    previewWithdrawal: fn(fakePreviewWithdrawal),
    withdraw: fn(fakeWithdraw),
    leaveWaitlist: fn(fakeLeaveWaitlist),
  },
} satisfies Meta<typeof JoinedSessionsPageHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () => within(document.body).getByRole("dialog");
const dialogClosed = () => waitFor(() => expect(within(document.body).queryByRole("dialog")).not.toBeInTheDocument());
const row = (canvas: { getAllByRole: (role: "listitem") => HTMLElement[] }, venue: string) =>
  within(canvas.getAllByRole("listitem").find((item) => item.textContent?.includes(venue))!);
const listed = (canvas: { findAllByRole: (role: "listitem") => Promise<HTMLElement[]> }) => canvas.findAllByRole("listitem");
const openWithdraw = async (canvas: Parameters<typeof row>[0] & Parameters<typeof listed>[0], venue: string) => {
  await listed(canvas);
  await userEvent.click(row(canvas, venue).getByRole("button", { name: /withdraw from/i }));
};
const calls = <T extends (...args: never[]) => unknown>(mock: T) => (mock as unknown as ReturnType<typeof fn<T>>).mock.calls;

/** Places held and waitlist places, each with its way out; fits a 390px phone. */
export const Joined: Story = {
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getAllByRole("listitem")).toHaveLength(3));
    await expect(row(canvas, "Bishan Sports Hall").getByText("You have a place")).toBeVisible();
    await expect(row(canvas, "Bishan Sports Hall").getByText("S$12.50")).toBeVisible();
    await expect(row(canvas, "Jurong East Sports Hall").getByText("On the waitlist")).toBeVisible();
    await expect(within(document.body).queryByRole("dialog")).not.toBeInTheDocument();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const Loading: Story = {
  args: { loadJoinedSessions: fn<LoadJoinedSessions>(() => new Promise(() => undefined)) },
  play: async ({ canvas }) => { await expect(canvas.getByText("Loading your sessions…")).toBeVisible(); },
};

export const NothingJoined: Story = {
  args: { loadJoinedSessions: fn<LoadJoinedSessions>(async () => []) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("You haven't joined any sessions")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Find a session" })).toHaveAttribute("href", "/discover");
  },
};

let listAttempts = 0;
export const LoadFailedThenRetried: Story = {
  beforeEach: () => { listAttempts = 0; },
  args: {
    loadJoinedSessions: fn<LoadJoinedSessions>(async () => {
      listAttempts += 1;
      if (listAttempts === 1) throw new Error("offline");
      return fakeLoadJoinedSessions();
    }),
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(canvas.getAllByRole("listitem")).toHaveLength(3));
  },
};

/** More than 30 hours before the start: the refund is shown first, rechecked, then the place opens to the waitlist. */
export const WithdrawWithFullRefund: Story = {
  play: async ({ args, canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await waitFor(() => expect(within(dialog()).getByText("S$12.50")).toBeVisible());
    const withdraw = within(dialog()).getByRole("button", { name: "Withdraw" });
    await expect(withdraw).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(withdraw);
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("S$12.50 is back in your wallet."));
    // Shown when the dialog opened, and checked again just before withdrawing.
    await expect(args.previewWithdrawal).toHaveBeenCalledTimes(2);
    await expect(args.withdraw).toHaveBeenCalledWith(expect.objectContaining({ sessionId: earlySession.sessionId, replacement: { mode: "OPEN_SLOT" } }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(canvas.queryByText("Bishan Sports Hall")).not.toBeInTheDocument());
  },
};

/** 30 hours or less before the start: nothing comes back now; the player names one replacement. */
export const LateWithdrawalInvitingSomeone: Story = {
  play: async ({ args, canvas }) => {
    await openWithdraw(canvas, "Kallang Tennis Centre");
    await waitFor(() => expect(within(dialog()).getByText(/stays held until\s+someone takes your place/i)).toBeVisible());
    await expect(within(dialog()).getByText("S$0.00")).toBeVisible();
    await userEvent.click(within(dialog()).getByRole("radio", { name: /invite one person/i }));
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
    await openWithdraw(canvas, "Bishan Sports Hall");
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
    await openWithdraw(canvas, "Bishan Sports Hall");
    await waitFor(() => expect(within(dialog()).getByText(/couldn't check your refund/i)).toBeVisible());
    await expect(within(dialog()).getByRole("button", { name: "Withdraw" })).toBeDisabled();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(dialog()).getByText("S$12.50")).toBeVisible());
  },
};

/** A slow, older preview that finishes last never replaces the newer one. */
let resolveOlderPreview: ((result: Awaited<ReturnType<PreviewWithdrawal>>) => void) | undefined;
let stalePreviewCalls = 0;
export const OlderPreviewIgnored: Story = {
  beforeEach: () => { resolveOlderPreview = undefined; stalePreviewCalls = 0; },
  args: {
    previewWithdrawal: fn<PreviewWithdrawal>((sessionId) => {
      stalePreviewCalls += 1;
      if (stalePreviewCalls === 1) return new Promise((resolve) => { resolveOlderPreview = resolve; });
      return fakePreviewWithdrawal(sessionId);
    }),
  },
  play: async ({ canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await waitFor(() => expect(within(dialog()).getByText("Checking your refund…")).toBeVisible());
    await userEvent.click(within(dialog()).getByRole("button", { name: "Keep my place" }));
    await dialogClosed();
    await openWithdraw(canvas, "Bishan Sports Hall");
    await waitFor(() => expect(within(dialog()).getByText("S$12.50")).toBeVisible());
    resolveOlderPreview!({ status: "error", message: "We couldn't check your refund. Please try again." });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(within(dialog()).queryByText(/couldn't check your refund/i)).not.toBeInTheDocument();
    await expect(within(dialog()).getByText("S$12.50")).toBeVisible();
  },
};

/** The refund changed at the 30-hour cutoff while the dialog was open: nothing happens until the player confirms the new terms. */
let recheckCalls = 0;
export const RefundChangedBeforeConfirming: Story = {
  beforeEach: () => { recheckCalls = 0; },
  args: {
    previewWithdrawal: fn<PreviewWithdrawal>(async (sessionId) => {
      recheckCalls += 1;
      return recheckCalls === 1 ? fakePreviewWithdrawal(sessionId) : { status: "ready", preview: { kind: "AWAITING_REPLACEMENT", refundCents: 0, heldCents: 1250 } };
    }),
    withdraw: fn<WithdrawFromSession>(async () => ({ status: "withdrawn", kind: "AWAITING_REPLACEMENT", refundedCents: 0 })),
  },
  play: async ({ args, canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByText(/your refund changed while this was open/i)).toBeVisible());
    await expect(within(dialog()).getByText("S$0.00")).toBeVisible();
    await expect(args.withdraw).not.toHaveBeenCalled();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw with new terms" }));
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("stays held until someone takes your place"));
    await expect(args.withdraw).toHaveBeenCalledOnce();
  },
};

/** The cutoff passed between the recheck and the withdrawal: the server's result is shown, with why. */
export const CutoffPassedWhileWithdrawing: Story = {
  args: { withdraw: fn<WithdrawFromSession>(async () => ({ status: "withdrawn", kind: "AWAITING_REPLACEMENT", refundedCents: 0 })) },
  play: async ({ canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByText(/30-hour cutoff passed while you were confirming/i)).toBeVisible());
  },
};

/** An unconfirmed result keeps the exact request and retries it, so nothing happens twice. */
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
    await openWithdraw(canvas, "Bishan Sports Hall");
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByText(/couldn't confirm whether you withdrew/i)).toBeVisible());
    await expect(within(dialog()).getByText(/your place opens to the waitlist/i)).toBeVisible();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry withdrawal" }));
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("is back in your wallet"));
    const [first, second] = calls(args.withdraw);
    await expect(second![0]).toEqual(first![0]);
  },
};

/**
 * The withdrawal may already have happened, so the preview now fails (409). Reopening the
 * dialog still offers the retry, without asking for another preview.
 */
let lostAttempts = 0;
let lostPreviews = 0;
export const UnconfirmedRetryNeedsNoNewPreview: Story = {
  beforeEach: () => { lostAttempts = 0; lostPreviews = 0; },
  args: {
    previewWithdrawal: fn<PreviewWithdrawal>(async (sessionId) => {
      lostPreviews += 1;
      // The first two previews (open + recheck) succeed; afterwards the place is already withdrawn.
      return lostPreviews <= 2 ? fakePreviewWithdrawal(sessionId) : { status: "error", message: "Your place has already changed. Refresh to see your sessions." };
    }),
    withdraw: fn<WithdrawFromSession>(async (request) => {
      lostAttempts += 1;
      return lostAttempts === 1
        ? { status: "error", code: "UNKNOWN_RESULT", message: "We couldn't confirm whether you withdrew. Try again: the same request is reused, so nothing happens twice.", unconfirmed: true }
        : fakeWithdraw(request);
    }),
  },
  play: async ({ args, canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Retry withdrawal" })).toBeEnabled());
    // The place may already be withdrawn, so the dialog no longer offers to keep it.
    await expect(within(dialog()).queryByRole("button", { name: "Keep my place" })).not.toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry later" }));
    await dialogClosed();
    await openWithdraw(canvas, "Bishan Sports Hall");
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Retry withdrawal" })).toBeEnabled());
    await expect(args.previewWithdrawal).toHaveBeenCalledTimes(2);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry withdrawal" }));
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("is back in your wallet"));
    const [first, second] = calls(args.withdraw);
    await expect(second![0]).toEqual(first![0]);
  },
};

/** A retry that fails (here, an expired login) never discards the earlier uncertain withdrawal. */
let keptAttempts = 0;
export const FailedRetryKeepsTheRequest: Story = {
  beforeEach: () => { keptAttempts = 0; },
  args: {
    withdraw: fn<WithdrawFromSession>(async (request) => {
      keptAttempts += 1;
      if (keptAttempts === 1) return { status: "error", code: "UNKNOWN_RESULT", message: "We couldn't confirm whether you withdrew. Try again: the same request is reused, so nothing happens twice.", unconfirmed: true };
      if (keptAttempts === 2) return { status: "error", code: "UNAUTHENTICATED", message: "Log in again to manage your sessions.", unconfirmed: false };
      return fakeWithdraw(request);
    }),
  },
  play: async ({ args, canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Retry withdrawal" }));
    await waitFor(() => expect(within(dialog()).getByText("Log in again to manage your sessions.")).toBeVisible());
    // Still the same unresolved request: no new choice, no new preview.
    await expect(within(dialog()).getByRole("button", { name: "Retry withdrawal" })).toBeEnabled();
    await expect(within(dialog()).queryByRole("radio")).not.toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry withdrawal" }));
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("is back in your wallet"));
    const sent = calls(args.withdraw).map(([request]) => request);
    await expect(sent).toHaveLength(3);
    await expect(sent[1]).toEqual(sent[0]);
    await expect(sent[2]).toEqual(sent[0]);
  },
};

/** An unresolved withdrawal saved before a reload is offered as a retry straight away, without a preview. */
const savedWithdrawal: UnresolvedWithdrawal = {
  request: { sessionId: earlySession.sessionId, idempotencyKey: "saved-before-reload", replacement: { mode: "OPEN_SLOT" } },
  preview: { kind: "REFUNDED", refundCents: 1250, heldCents: 1250 },
};
let reloadStore = memoryUnresolvedStore<UnresolvedWithdrawal>();
export const UnresolvedAfterReload: Story = {
  beforeEach: () => { reloadStore = memoryUnresolvedStore(new Map([[earlySession.sessionId, savedWithdrawal]])); },
  render: (args) => <JoinedSessionsPageHarness {...args} withdrawalStore={reloadStore} />,
  play: async ({ args, canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Retry withdrawal" })).toBeEnabled());
    await expect(args.previewWithdrawal).not.toHaveBeenCalled();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry withdrawal" }));
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("is back in your wallet"));
    await expect(args.withdraw).toHaveBeenCalledOnce();
    await expect(args.withdraw).toHaveBeenCalledWith(savedWithdrawal.request);
    await waitFor(() => expect(reloadStore.saved().size).toBe(0));
  },
};

/** The server's list shows the place has already gone, which establishes the saved request's outcome. */
let goneStore = memoryUnresolvedStore<UnresolvedWithdrawal>();
export const UnresolvedAlreadySettled: Story = {
  beforeEach: () => {
    goneStore = memoryUnresolvedStore(new Map([["77777777-7777-4777-8777-777777777777", { ...savedWithdrawal, request: { ...savedWithdrawal.request, sessionId: "77777777-7777-4777-8777-777777777777" } }]]));
  },
  render: (args) => <JoinedSessionsPageHarness {...args} withdrawalStore={goneStore} />,
  play: async ({ canvas }) => {
    await listed(canvas);
    await waitFor(() => expect(goneStore.saved().size).toBe(0));
  },
};

/** Coming back to the tab never replaces the refund the player is looking at. */
let shownCalls = 0;
export const ShownRefundStaysUntilConfirmed: Story = {
  beforeEach: () => { shownCalls = 0; },
  args: {
    previewWithdrawal: fn<PreviewWithdrawal>(async (sessionId) => {
      shownCalls += 1;
      return shownCalls === 1 ? fakePreviewWithdrawal(sessionId) : { status: "ready", preview: { kind: "AWAITING_REPLACEMENT", refundCents: 0, heldCents: 1250 } };
    }),
  },
  play: async ({ args, canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await waitFor(() => expect(within(dialog()).getByText("S$12.50")).toBeVisible());
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(within(dialog()).getByText("S$12.50")).toBeVisible();
    await expect(args.previewWithdrawal).toHaveBeenCalledOnce();
    // Confirming checks the server and shows the change instead of withdrawing.
    await userEvent.click(within(dialog()).getByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByText(/your refund changed while this was open/i)).toBeVisible());
    await expect(args.withdraw).not.toHaveBeenCalled();
  },
};

/** A definite rejection unlocks the choice; the next attempt is a new request. */
export const WithdrawalRejected: Story = {
  args: {
    withdraw: fn<WithdrawFromSession>(async () => ({ status: "error", code: "SESSION_STARTED", message: "This session has already started, so you can't withdraw.", unconfirmed: false })),
  },
  play: async ({ canvas }) => {
    await openWithdraw(canvas, "Bishan Sports Hall");
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /open it to the waitlist/i }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(within(dialog()).getByText(/already started/i)).toBeVisible());
    await expect(within(dialog()).getByRole("radio", { name: /invite one person/i })).toBeEnabled();
  },
};

export const LeaveTheWaitlist: Story = {
  play: async ({ args, canvas }) => {
    await listed(canvas);
    await userEvent.click(row(canvas, "Jurong East Sports Hall").getByRole("button", { name: /leave the waitlist/i }));
    await waitFor(() => expect(within(dialog()).getByText(/no money moves/i)).toBeVisible());
    await userEvent.click(within(dialog()).getByRole("button", { name: "Leave waitlist" }));
    await waitFor(() => expect(canvas.queryByText("Jurong East Sports Hall")).not.toBeInTheDocument());
    await expect(args.leaveWaitlist).toHaveBeenCalledWith(expect.objectContaining({ sessionId: waitlistedSession.sessionId }));
  },
};

/** An unconfirmed departure keeps its idempotency key, even when a retry fails. */
let leaveAttempts = 0;
export const UnconfirmedLeaveRetried: Story = {
  beforeEach: () => { leaveAttempts = 0; },
  args: {
    leaveWaitlist: fn<LeaveWaitlist>(async () => {
      leaveAttempts += 1;
      if (leaveAttempts === 1) return { status: "error", code: "UNKNOWN_RESULT", message: "We couldn't confirm whether you left the waitlist. Please try again.", unconfirmed: true };
      if (leaveAttempts === 2) return { status: "error", code: "UNAUTHENTICATED", message: "Log in again to manage your sessions.", unconfirmed: false };
      return { status: "left" };
    }),
  },
  play: async ({ args, canvas }) => {
    await listed(canvas);
    await userEvent.click(row(canvas, "Jurong East Sports Hall").getByRole("button", { name: /leave the waitlist/i }));
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Leave waitlist" }));
    await waitFor(() => expect(within(dialog()).getByText(/couldn't confirm whether you left/i)).toBeVisible());
    // The player may already have left, so the dialog doesn't offer to keep their place.
    await expect(within(dialog()).getByRole("button", { name: "Retry later" })).toBeVisible();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry leaving" }));
    await waitFor(() => expect(within(dialog()).getByText("Log in again to manage your sessions.")).toBeVisible());
    await userEvent.click(within(dialog()).getByRole("button", { name: "Retry leaving" }));
    await waitFor(() => expect(canvas.queryByText("Jurong East Sports Hall")).not.toBeInTheDocument());
    const keys = calls(args.leaveWaitlist).map(([request]) => request.idempotencyKey);
    await expect(new Set(keys).size).toBe(1);
    await expect(keys).toHaveLength(3);
  },
};

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => { await waitFor(() => expect(canvas.getAllByRole("listitem")).toHaveLength(3)); },
};
