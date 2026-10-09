import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, fn, userEvent, waitFor } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import type { HostedSessionsResponse } from "../hosted-sessions-contract";
import { HostedSessionsLoadError } from "../hosted-sessions-transport";
import { getSessionAccountActions, toHostedSessionActions } from "../session-actions";
import { HostedSessionsController } from "./hosted-sessions-controller";

const response: HostedSessionsResponse = {
  sessions: [{
    sessionId: "private", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: "2035-05-12T10:00:00Z", endAt: "2035-05-12T12:00:00Z",
    visibility: "PRIVATE", availableSlots: 3, actions: [...toHostedSessionActions("private", [{ name: "set-visibility", visibility: "PUBLIC" }, { name: "preview-cancellation" }])],
  }],
  awaitingAttendance: [],
};

// Counts calls across a story's renders; reset before each story.
let calls = 0;
let replies: readonly (() => Promise<HostedSessionsResponse>)[] = [];
function load(): Promise<HostedSessionsResponse> {
  const reply = replies[Math.min(calls, replies.length - 1)]!;
  calls += 1;
  return reply();
}

const meta = {
  title: "Sessions/Hosted sessions loading",
  component: HostedSessionsController,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/sessions" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => (
    // A fresh query cache per story, so one story's data never leaks into the next.
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppShell user={{ name: "Neoh", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>
    </QueryClientProvider>
  )],
  args: {
    userId: "booker",
    actions: getSessionAccountActions({ accountStatus: "ACTIVE", email: "player@example.com", emailVerified: true }),
    loadHostedSessions: load,
  },
  beforeEach: () => { calls = 0; replies = [() => Promise.resolve(response)]; },
} satisfies Meta<typeof HostedSessionsController>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Bishan Sports Hall")).toBeVisible();
    await expect(calls).toBe(1);
  },
};

export const Loading: Story = {
  beforeEach: () => { replies = [() => new Promise<HostedSessionsResponse>(() => undefined)]; },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Loading your sessions…")).toBeVisible();
  },
};

export const FailedThenRetried: Story = {
  beforeEach: () => { replies = [() => Promise.reject(new HostedSessionsLoadError("NETWORK_ERROR", "unexpected", false)), () => Promise.resolve(response)]; },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Retry" }));
    await expect(await canvas.findByText("Bishan Sports Hall")).toBeVisible();
    await expect(calls).toBe(2);
  },
};

/** A failed reload shows Retry instead of the old list; Retry reloads the sessions and the page's account actions. */
export const ReloadFailedThenRetried: Story = {
  beforeEach: () => {
    replies = [
      () => Promise.resolve(response),
      () => Promise.reject(new HostedSessionsLoadError("INTERNAL_ERROR", "unexpected", false)),
      () => Promise.resolve(response),
    ];
  },
  play: async ({ canvas }) => {
    await canvas.findByText("Bishan Sports Hall");
    // Returning to the tab reloads the sessions in the background; this reload fails.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    const retry = await canvas.findByRole("button", { name: "Retry" });
    await expect(canvas.queryByText("Bishan Sports Hall")).not.toBeInTheDocument();
    await userEvent.click(retry);
    await expect(getRouter().refresh).toHaveBeenCalledOnce();
    await expect(await canvas.findByText("Bishan Sports Hall")).toBeVisible();
    await expect(calls).toBe(3);
  },
};

export const SignedOut: Story = {
  beforeEach: () => { replies = [() => Promise.reject(new HostedSessionsLoadError("UNAUTHENTICATED", "unexpected", true))]; },
  play: async ({ canvas }) => {
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith("/login?next=%2Fsessions"));
    await expect(canvas.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  },
};

export const InactiveAccount: Story = {
  beforeEach: () => { replies = [() => Promise.reject(new HostedSessionsLoadError("INACTIVE_ACCOUNT", "unexpected", true))]; },
  play: async () => {
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith("/login"));
  },
};
