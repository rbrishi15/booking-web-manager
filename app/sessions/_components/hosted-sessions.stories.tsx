import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import type { SessionVisibilityActionResult } from "../actions";
import type { HostedSessionItem } from "../types";
import { HostedSessionsView, type HostedSessionsViewProps } from "./hosted-sessions-view";

const sessions: readonly HostedSessionItem[] = [
  { sessionId: "private", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central", startAt: "2035-05-12T10:00:00Z", endAt: "2035-05-12T12:00:00Z", visibility: "PRIVATE", availableSlots: 3 },
  { sessionId: "full", venueName: "Jurong East Sports Hall", sport: "Tennis", region: "West", startAt: "2035-05-13T10:00:00Z", endAt: "2035-05-13T12:00:00Z", visibility: "PUBLIC", availableSlots: 0 },
];

const meta = {
  title: "Sessions/Hosted sessions",
  component: HostedSessionsView,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/sessions" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Neoh", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>],
  args: {
    outcome: { status: "ready", sessions }, refreshing: false, onRefresh: fn(),
    onSetVisibility: fn(async (sessionId: string, visibility: "PUBLIC" | "PRIVATE"): Promise<SessionVisibilityActionResult> => ({ status: "saved", sessionId, visibility })),
  },
} satisfies Meta<typeof HostedSessionsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hosted: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Sessions you host" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Make public" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Make private" })).toBeDisabled();
    await expect(canvas.getByText("This session is full. Visibility cannot be changed.")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

function DeferredSave() {
  const [items, setItems] = useState(sessions);
  const [finish, setFinish] = useState<(() => void) | null>(null);
  function save(sessionId: string, visibility: "PUBLIC" | "PRIVATE") {
    return new Promise<SessionVisibilityActionResult>((resolve) => {
      setFinish(() => () => {
        setItems((current) => current.map((session) => session.sessionId === sessionId ? { ...session, visibility } : session));
        resolve({ status: "saved", sessionId, visibility });
        setFinish(null);
      });
    });
  }
  return <>
    <HostedSessionsView outcome={{ status: "ready", sessions: items }} refreshing={false} onSetVisibility={save} onRefresh={fn()} />
    {finish && <Button onClick={finish}>Finish test request</Button>}
    <Button onClick={() => setItems(sessions)}>Restore server private state</Button>
  </>;
}

export const WaitsForConfirmation: Story = {
  render: () => <DeferredSave />,
  play: async ({ canvas }) => {
    const row = within(canvas.getByRole("article", { name: "Badminton at Bishan Sports Hall" }));
    await userEvent.click(row.getByRole("button", { name: "Make public" }));
    await expect(row.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(row.getByText("Private", { exact: true })).toBeVisible();
    await expect(row.queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Finish test request" }));
    await waitFor(() => expect(row.getByRole("button", { name: "Make private" })).toBeEnabled());
    await expect(row.getByText("Public", { exact: true })).toBeVisible();
    await expect(row.getByRole("status")).toHaveTextContent("Session is now public.");
    await userEvent.click(canvas.getByRole("button", { name: "Restore server private state" }));
    await expect(row.getByText("Private", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Make public" })).toBeEnabled();
    await expect(row.queryByRole("status")).not.toBeInTheDocument();
  },
};

export const Rejected: Story = {
  args: { onSetVisibility: fn<HostedSessionsViewProps["onSetVisibility"]>(async () => ({ status: "error", code: "CAPACITY_EXCEEDED", message: "The session is now full.", refresh: true })) },
  play: async ({ canvas, args }) => {
    const row = within(canvas.getByRole("article", { name: "Badminton at Bishan Sports Hall" }));
    await userEvent.click(row.getByRole("button", { name: "Make public" }));
    await expect(row.getByRole("alert")).toHaveTextContent("The session is now full.");
    await expect(row.getByText("Private", { exact: true })).toBeVisible();
    await expect(args.onSetVisibility).toHaveBeenCalledWith("private", "PUBLIC");
    await expect(args.onRefresh).toHaveBeenCalledOnce();
  },
};

export const NetworkFailure: Story = {
  args: { onSetVisibility: fn<HostedSessionsViewProps["onSetVisibility"]>(async () => { throw new Error("private transport detail"); }) },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Make public" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("We couldn't change visibility. Please try again.");
    await expect(canvas.getByRole("button", { name: "Make public" })).toBeEnabled();
    await expect(args.onRefresh).not.toHaveBeenCalled();
  },
};

export const Empty: Story = {
  args: { outcome: { status: "ready", sessions: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No upcoming sessions to manage")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Find a session" })).toHaveAttribute("href", "/discover?returnTo=%2Fsessions");
  },
};
export const Unavailable: Story = { args: { outcome: { status: "error", kind: "unavailable" } } };
export const ReadFailure: Story = {
  args: { outcome: { status: "error", kind: "unexpected" } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRefresh).toHaveBeenCalledOnce();
  },
};
export const Desktop: Story = { globals: { viewport: { value: "desktop", isRotated: false } } };
export const Dark: Story = { globals: { theme: "dark" } };
