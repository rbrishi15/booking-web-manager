import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { SessionsController } from "./sessions-controller";
import { hostedSessions, sessionAccountActions } from "./sessions-fixtures";
import { toHostedSessionActions } from "../session-actions";
import type { SessionFeedItem } from "../session-feed-contract";

const session: SessionFeedItem = {
  ...hostedSessions[0]!, venueName: "PCF SPARKLETOTS PRESCHOOL @ CHUA CHU KANG BLK 123 (KN)", region: "West",
  startAt: "2026-11-06T09:50:00+08:00", endAt: "2026-11-06T11:20:00+08:00", capacity: 8, participantCount: 0,
};
let client: QueryClient;
const meta = {
  title: "Sessions/Session details", component: SessionsController,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/sessions", query: { tab: "hosting" } } } },
  decorators: [(Story) => <QueryClientProvider client={client}><AppShell user={{ name: "Tian Pok Neoh", reliabilityScore: 96 }}><Story /></AppShell></QueryClientProvider>],
  args: {
    userId: "details-preview", actions: sessionAccountActions,
    loadFeed: async () => ({ sessions: [session], nextCursor: null, asOf: "2026-10-29T08:00:00+08:00", upcomingCount: 1, pastCount: 0 }),
    loadHosted: async () => ({ sessions: [{ ...session, availableSlots: 8, actions: [...toHostedSessionActions(session.sessionId, [{ name: "set-visibility", visibility: "PRIVATE" }, { name: "preview-cancellation" }])] }], awaitingAttendance: [] }),
  },
  beforeEach: ({ parameters }) => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    const originalUrl = window.location.href;
    const url = new URL(originalUrl);
    url.searchParams.set("tab", parameters.nextjs?.navigation?.query?.tab ?? "hosting");
    window.history.replaceState(window.history.state, "", url);
    return () => { client.clear(); window.history.replaceState(window.history.state, "", originalUrl); };
  },
  play: async ({ canvas, parameters }) => {
    if (parameters.themes?.themeOverride === "dark") await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    await userEvent.click(await canvas.findByRole("button", { name: window.innerWidth < 768 ? `View Tennis Court Booking at ${session.venueName}, 6 Nov 2026` : `Manage Tennis Court Booking at ${session.venueName}` }));
    const element = await screen.findByRole("dialog", { name: "Tennis session" });
    const dialog = within(element);
    await waitFor(() => expect(dialog.getByRole("button", { name: "Copy invitation link" })).toBeVisible());
    await expect(dialog.getByText("Friday, 6 November 2026")).toBeVisible();
    await expect(dialog.getByLabelText("0 of 8 players joined")).toBeVisible();
    await expect(dialog.getByRole("group", { name: "Session visibility" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getAllByText("PCF Sparkletots Preschool @ Chua Chu Kang Blk 123 (KN)", { exact: true })).toHaveLength(1);
    await expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
    await waitFor(() => expect(element.getBoundingClientRect().width).toBeLessThanOrEqual(760));
  },
} satisfies Meta<typeof SessionsController>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Hosting: Story = {};
export const HostingDark: Story = { parameters: { themes: { themeOverride: "dark" } }, globals: { theme: "dark" } };
export const HostingMobile: Story = { globals: { viewport: { value: "phone", isRotated: false } } };
export const HostingMobileDark: Story = { parameters: { themes: { themeOverride: "dark" } }, globals: { theme: "dark", viewport: { value: "phone", isRotated: false } } };

export const CancelledHistory: Story = {
  args: {
    loadFeed: async () => ({ sessions: [{ ...session, status: "CANCELLED", section: "past" }], nextCursor: null, asOf: "2026-10-29T08:00:00+08:00", upcomingCount: 0, pastCount: 1 }),
    loadHosted: async () => ({ sessions: [], awaitingAttendance: [] }),
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: `View Tennis Court Booking at ${session.venueName}, 6 Nov 2026` }));
    const dialog = within(await screen.findByRole("dialog", { name: "Tennis session" }));
    await waitFor(() => expect(dialog.getByRole("link", { name: "View participants" })).toBeVisible());
    await expect(dialog.queryByRole("button", { name: "Cancel session" })).not.toBeInTheDocument();
    await expect(dialog.queryByRole("button", { name: "Copy invitation link" })).not.toBeInTheDocument();
  },
};

export const Joined: Story = {
  parameters: { nextjs: { navigation: { query: { tab: "joined" } } } },
  args: { loadFeed: async () => ({ sessions: [{ ...session, role: "PARTICIPANT", participationStatus: "COMMITTED", participantCount: 3 }], nextCursor: null, asOf: "2026-10-29T08:00:00+08:00", upcomingCount: 1, pastCount: 0 }) },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: window.innerWidth < 768 ? `View Tennis Court Booking at ${session.venueName}, 6 Nov 2026` : "View details" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Tennis Court Booking" }));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Leave session" })).toBeVisible());
    await expect(dialog.getByRole("heading", { name: "Tennis Court Booking" })).toBeVisible();
    await expect(dialog.getByText("3 / 8")).toBeVisible();
    await expect(dialog.getByText("Held from your wallet")).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Participants (3)" })).toBeVisible();
    await expect(dialog.queryByRole("button", { name: "Cancel session" })).not.toBeInTheDocument();
    await expect(dialog.queryByRole("button", { name: "Copy invitation link" })).not.toBeInTheDocument();
  },
};


export const JoinedDark: Story = {
  ...Joined,
  parameters: { ...Joined.parameters, themes: { themeOverride: "dark" } },
  globals: { theme: "dark" },
};
export const JoinedMobile: Story = { ...Joined, globals: { viewport: { value: "phone", isRotated: false } } };
export const JoinedMobileDark: Story = {
  ...JoinedDark,
  globals: { theme: "dark", viewport: { value: "phone", isRotated: false } },
};

/** Regression for long address copy: no clipped venue text or horizontal modal overflow. */
const longVenueName = "PCF SPARKLETOTS PRESCHOOL @ CHUA CHU KANG BLK 123 (KN) - TENNIS COURT";
export const JoinedLongVenue: Story = {
  ...Joined,
  args: {
    loadFeed: async () => ({
      sessions: [{ ...session, venueName: longVenueName, role: "PARTICIPANT", participationStatus: "COMMITTED", participantCount: 3 }],
      nextCursor: null, asOf: "2026-10-29T08:00:00+08:00", upcomingCount: 1, pastCount: 0,
    }),
  },
  play: async ({ canvas, parameters }) => {
    if (parameters.themes?.themeOverride === "dark") await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    await userEvent.click(await canvas.findByRole("button", {
      name: window.innerWidth < 768 ? `View Tennis Court Booking at ${longVenueName}, 6 Nov 2026` : "View details",
    }));
    const element = await screen.findByRole("dialog", { name: "Tennis Court Booking" });
    const dialog = within(element);
    const schedule = dialog.getByRole("region", { name: "Session schedule and location" });
    const location = dialog.getByRole("link", { name: /PCF Sparkletots Preschool/ });
    await expect(location).toBeVisible();
    await expect(dialog.getByRole("link", { name: /View in calendar/ })).toBeVisible();
    await waitFor(() => {
      expect(schedule.scrollWidth).toBeLessThanOrEqual(schedule.clientWidth + 1);
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
      expect(location.getBoundingClientRect().right).toBeLessThanOrEqual(schedule.getBoundingClientRect().right + 1);
    });
    await userEvent.click(dialog.getByRole("tab", { name: "Participants (3)" }));
    await expect(dialog.getByRole("tabpanel")).toBeVisible();
    await expect(location).toBeVisible();
  },
};
export const JoinedLongVenueDark: Story = {
  ...JoinedLongVenue,
  parameters: { ...JoinedLongVenue.parameters, themes: { themeOverride: "dark" } },
  globals: { theme: "dark" },
};
export const JoinedLongVenueMobile: Story = {
  ...JoinedLongVenue,
  globals: { viewport: { value: "phone", isRotated: false } },
};
export const JoinedLongVenueMobileDark: Story = {
  ...JoinedLongVenueDark,
  globals: { theme: "dark", viewport: { value: "phone", isRotated: false } },
};

export const JoinedWaitlisted: Story = {
  ...Joined,
  args: { loadFeed: async () => ({ sessions: [{ ...session, role: "PARTICIPANT", participationStatus: "WAITLISTED", participantCount: 3 }], nextCursor: null, asOf: "2026-10-29T08:00:00+08:00", upcomingCount: 1, pastCount: 0 }) },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: window.innerWidth < 768 ? `View Tennis Court Booking at ${session.venueName}, 6 Nov 2026` : "View details" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Tennis Court Booking" }));
    await expect(dialog.getByText("No funds held")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Leave waitlist" })).toBeVisible();
    await expect(dialog.queryByText("Held from your wallet")).not.toBeInTheDocument();
  },
};

export const InProgress: Story = {
  ...Joined,
  args: { loadFeed: async () => ({ sessions: [{ ...session, role: "PARTICIPANT", participationStatus: "COMMITTED", participantCount: 3 }], nextCursor: null, asOf: "2026-11-06T10:15:00+08:00", upcomingCount: 1, pastCount: 0 }) },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "View details" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Tennis Court Booking" }));
    await waitFor(() => expect(dialog.getByRole("tabpanel")).toHaveTextContent("3 / 8"));
    await expect(dialog.queryByRole("button", { name: "Leave session" })).not.toBeInTheDocument();
  },
};

/** Regression coverage for completed player sessions and their retained actions. */
export const JoinedCompleted: Story = {
  ...Joined,
  args: { loadFeed: async () => ({ sessions: [{ ...session, venueName: "CLEMENTI CASCADIA", role: "PARTICIPANT", participationStatus: "COMMITTED", participantCount: 4, capacity: 4, status: "SETTLED", section: "past", startAt: "2026-10-29T10:19:00+08:00", endAt: "2026-10-29T11:19:00+08:00" }], nextCursor: null, asOf: "2026-10-29T12:00:00+08:00", upcomingCount: 0, pastCount: 1 }) },
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole("button", { name: window.innerWidth < 768 ? "View Tennis Court Booking at CLEMENTI CASCADIA, 29 Oct 2026" : "View details" });
    await userEvent.click(trigger);
    const element = await screen.findByRole("dialog", { name: "Tennis Court Booking" });
    const dialog = within(element);
    await waitFor(() => expect(dialog.getByText("Completed")).toBeVisible());
    const photo = element.querySelector("img");
    await expect(photo).not.toBeNull();
    await expect(photo).toBeVisible();
    await expect(dialog.getByText("4 / 4")).toBeVisible();
    await expect(dialog.getByRole("link", { name: /View in calendar/ })).toHaveAttribute("href", expect.stringContaining("calendar.google.com"));
    const participants = dialog.getByRole("tab", { name: "Participants (4)" });
    await userEvent.click(participants);
    await expect(dialog.getByRole("tabpanel")).toHaveTextContent("4 players have a place in this session.");
    await userEvent.keyboard("{Home}");
    await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.queryByRole("button", { name: "Leave session" })).not.toBeInTheDocument();
    await expect(dialog.queryByRole("button", { name: "Cancel session" })).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const JoinedCompletedMobile: Story = { ...JoinedCompleted, globals: { viewport: { value: "phone", isRotated: false } } };

export const MobileSheetDismiss: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole("button", { name: `View Tennis Court Booking at ${session.venueName}, 6 Nov 2026` });
    await userEvent.click(trigger);
    const element = await screen.findByRole("dialog", { name: "Tennis session" });
    const dialog = within(element);
    const handle = await dialog.findByRole("button", { name: "Dismiss session details" });
    await waitFor(() => expect(handle).toBeVisible());
    await userEvent.click(handle);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(trigger).toHaveFocus();
  },
};
