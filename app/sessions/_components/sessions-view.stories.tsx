import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { hostedSessions, joinedSessions, sessionAccountActions, sessionsAsOf } from "./sessions-fixtures";
import { SessionsView } from "./sessions-view";
import { SessionsUiProvider } from "./sessions-ui-provider";

const meta = {
  title: "Sessions/Overview",
  component: SessionsView,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/sessions" } },
    docs: {
      description: {
        component: "The signed-in sessions overview. Joined sessions use a chronological desktop agenda that opens at the next upcoming session. Wheel and trackpad gestures close the current card over 160 ms before placing the next or previous compact session, with no page-scroll animation. The dot eases to that date over 180 ms. All cards stay collapsed while browsing; after 200 ms of quiet in the compact view, the selected card opens. Clicking a date or compact session row switches immediately and starts opening that card. Keyboard navigation is available on the date controls. The active session places a wide photograph above its title, venue, and inline metadata, with a status badge over the photograph and a plain View details action to the right. Other sessions use unframed text rows with venue and time on the left and participant counts on the right. Dates sit in a dedicated timeline column, with larger selected dates. Time-based labels group the sessions. Detailed information and participant panels belong to the transient session dialog. Hosting shows upcoming cards and compact history. Below 768px both views use the simple dated list. Dates use Singapore time; artwork is decorative and participant icons represent aggregate counts.",
      },
    },
  },
  globals: { viewport: { value: "desktop", isRotated: false } },
  decorators: [(Story, { args }) => <SessionsUiProvider initialTab={args.tab}><AppShell user={{ name: "NTP", reliabilityScore: 96 }}><Story /></AppShell></SessionsUiProvider>],
  beforeEach: () => {
    window.scrollTo({ top: 0, behavior: "instant" });
  },
  args: {
    tab: "joined",
    onTabChange: fn(),
    sessions: joinedSessions,
    asOf: sessionsAsOf,
    upcomingCount: 4,
    pastCount: 6,
    actions: sessionAccountActions,
    onLoadMore: fn(),
    onRetry: fn(),
    onOpenSession: fn(),
  },
} satisfies Meta<typeof SessionsView>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectNoHorizontalOverflow() {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

async function expectFeedSkeleton(canvasElement: HTMLElement, tab: "joined" | "hosting", mobile = false) {
  const skeleton = canvasElement.querySelector<HTMLElement>(`[data-sessions-skeleton="${tab}"]`);
  if (!skeleton) throw new globalThis.Error(`The ${tab} sessions skeleton was not rendered.`);
  const desktopGraphic = skeleton.querySelector<HTMLElement>("[data-skeleton-desktop]");
  const mobileGraphic = skeleton.querySelector<HTMLElement>("[data-skeleton-mobile]");
  if (!desktopGraphic || !mobileGraphic) throw new globalThis.Error("Responsive skeleton graphics were not rendered.");
  await expect(desktopGraphic).toHaveAttribute("inert");
  await expect(mobileGraphic).toHaveAttribute("inert");
  await expect(mobile ? mobileGraphic : desktopGraphic).toBeVisible();
  await expect(mobile ? desktopGraphic : mobileGraphic).not.toBeVisible();
  await expect(skeleton.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  await expect(skeleton.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).toHaveLength(0);
  if (tab === "joined") {
    await expect(skeleton.querySelector("[data-skeleton-timeline]")).not.toBeNull();
    await expect(skeleton.querySelector("[data-skeleton-hosting]")).toBeNull();
  } else {
    await expect(skeleton.querySelector("[data-skeleton-hosting]")).not.toBeNull();
    await expect(skeleton.querySelector("[data-skeleton-timeline]")).toBeNull();
  }
}

let entrancePhases: string[] = [];
let entranceHeights: number[] = [];
let concealedContent: { phase: string; opacities: string[] }[] = [];

function observeEntrance() {
  entrancePhases = [];
  entranceHeights = [];
  concealedContent = [];
  const observer = new MutationObserver(() => {
    const timeline = document.querySelector<HTMLElement>("[data-timeline-entrance]");
    const phase = timeline?.dataset.timelineEntrance;
    if (!phase || phase === entrancePhases.at(-1)) return;
    entrancePhases.push(phase);
    const expanded = timeline?.querySelector<HTMLElement>("[data-timeline-expanded]");
    if (expanded) entranceHeights.push(expanded.getBoundingClientRect().height);
    if (timeline && (phase === "line" || phase === "dot")) {
      concealedContent.push({ phase, opacities: Array.from(timeline.querySelectorAll<HTMLElement>("[data-timeline-reveal]"), (element) => getComputedStyle(element).opacity) });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-timeline-entrance"] });
  return () => observer.disconnect();
}

async function expectTimelineContentRevealed(timeline: HTMLElement) {
  const content = Array.from(timeline.querySelectorAll<HTMLElement>("[data-timeline-reveal]")).filter((element) => !element.closest('[inert],[aria-hidden="true"]'));
  await expect(content.length).toBeGreaterThan(10);
  for (const element of content) await expect(getComputedStyle(element).opacity).toBe("1");
  await expect(timeline.getAnimations({ subtree: true }).filter((animation) => animation.constructor === Animation)).toHaveLength(0);
}

function timelineDay(canvasElement: HTMLElement, date: string) {
  const day = canvasElement.querySelector<HTMLElement>(`[data-date-control] time[datetime^="${date}"] strong`);
  if (!day) throw new globalThis.Error("The timeline date was not rendered.");
  return day;
}

async function expectTimelineHierarchy(canvasElement: HTMLElement, activeDate: string) {
  const activeDay = timelineDay(canvasElement, activeDate);
  await waitFor(() => {
    expect(getComputedStyle(activeDay).fontSize).toBe(window.innerWidth >= 1200 ? "52px" : "40px");
    expect(getComputedStyle(activeDay).fontWeight).toBe("650");
    for (const day of canvasElement.querySelectorAll<HTMLElement>("[data-date-control] time strong")) {
      if (day !== activeDay) {
        expect(getComputedStyle(day).fontSize).toBe(window.innerWidth >= 1200 ? "28px" : "24px");
        expect(getComputedStyle(day).fontWeight).toBe("600");
      }
    }
  });
  // Wait through the marker's movement, then compare actual centers so padding
  // or font changes cannot leave the dot aligned with an obsolete fixed offset.
  await waitFor(() => {
    const marker = canvasElement.querySelector<HTMLElement>("[data-timeline-marker]");
    if (!marker) throw new globalThis.Error("The current timeline marker was not rendered.");
    const markerBounds = marker.getBoundingClientRect();
    const dayBounds = activeDay.getBoundingClientRect();
    expect(Math.abs(markerBounds.top + markerBounds.height / 2 - dayBounds.top - dayBounds.height / 2)).toBeLessThan(1.5);
  });
}

/** Feed sections may arrive future-first; the desktop timeline always follows time. */
export const ChronologicalTimeline: Story = {
  args: {
    sessions: [joinedSessions[0]!, joinedSessions[4]!, {
      ...joinedSessions[0]!,
      sessionId: "54000000-0000-4000-8000-000000000011",
      startAt: "2026-10-22T19:00:00+08:00",
      endAt: "2026-10-22T20:00:00+08:00",
      section: "past",
      status: "CANCELLED",
    }],
    upcomingCount: 1,
    pastCount: 2,
  },
  play: async ({ canvas, args }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    const renderedIds = Array.from(timeline.querySelectorAll<HTMLElement>("[data-session-id]"), (row) => row.dataset.sessionId);
    await expect(renderedIds).toEqual([joinedSessions[4]!.sessionId, joinedSessions[0]!.sessionId, args.sessions[2]!.sessionId]);
    await expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 21 Oct 2026" })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 20 Oct 2026" })).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 22 Oct 2026" })).toHaveAttribute("aria-expanded", "false");
  },
};

export const DesktopJoined: Story = {
  play: async ({ canvas, canvasElement, args }) => {
    const heading = canvas.getByRole("heading", { level: 1, name: "Sessions" });
    await expect(heading).toHaveClass("sr-only");
    await expect(heading.getBoundingClientRect().height).toBeLessThanOrEqual(1);
    const overview = canvasElement.querySelector<HTMLElement>('[data-view="joined"]');
    if (!overview) throw new globalThis.Error("The Joined overview was not rendered.");
    await expect(within(overview).getByText(/My sessions/)).toBeVisible();
    const views = within(canvas.getByRole("navigation", { name: "Session views" }));
    await expect(views.getByRole("button", { name: /^I'm playing$/ })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByRole("link", { name: "Manage my places" })).toHaveAttribute("href", "/sessions/joined");
    canvas.getByRole("button", { name: "Show Tennis Court Booking, 21 Oct 2026" }).focus();
    await waitFor(() => expect(canvas.getByRole("heading", { name: "This week" })).toBeVisible());
    await expect(canvas.getByRole("heading", { name: "Earlier this month" })).toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: "Details" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tab", { name: "Participants (2)" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: /View in calendar/ })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "View details" }));
    await expect(args.onOpenSession).toHaveBeenCalledWith(joinedSessions[0]);
    await expect(canvas.getByRole("link", { name: /^New session$/ })).toHaveAttribute("href", "/sessions/create");
    await expectTimelineHierarchy(canvasElement, "2026-10-21");
    const feature = overview.querySelector<HTMLElement>("[data-timeline-expanded]");
    const photo = feature?.querySelector<HTMLElement>('[data-timeline-reveal="hero"]');
    const title = feature?.querySelector<HTMLElement>('[data-timeline-reveal="title"]');
    const subtitle = feature?.querySelector<HTMLElement>('[data-timeline-reveal="venue"]');
    const panel = overview.querySelector("header")?.parentElement;
    if (!feature || !photo || !title || !subtitle || !panel) throw new globalThis.Error("The editorial agenda was not rendered.");
    await expect(title).toHaveTextContent("Tennis Court Booking");
    await expect(subtitle).toHaveTextContent(`${joinedSessions[0]!.venueName} · ${joinedSessions[0]!.region}`);
    const featureBounds = feature.getBoundingClientRect();
    const photoBounds = photo.getBoundingClientRect();
    await expect(Math.abs(photoBounds.left - featureBounds.left)).toBeLessThan(1);
    await expect(Math.abs(photoBounds.top - featureBounds.top)).toBeLessThan(1);
    await expect(Math.abs(photoBounds.width - featureBounds.width)).toBeLessThan(1);
    await expect(Math.abs(photoBounds.height - Math.min(420, Math.max(240, photoBounds.width * 3 / 8)))).toBeLessThan(1);
    const activeDayBounds = timelineDay(canvasElement, "2026-10-21").getBoundingClientRect();
    await expect(activeDayBounds.top + activeDayBounds.height / 2).toBeGreaterThan(photoBounds.top);
    await expect(activeDayBounds.top + activeDayBounds.height / 2).toBeLessThan(photoBounds.top + photoBounds.height * .4);
    for (const text of [title, subtitle]) {
      const bounds = text.getBoundingClientRect();
      await expect(Math.abs(bounds.left - photoBounds.left)).toBeLessThan(1);
      await expect(bounds.right).toBeLessThanOrEqual(featureBounds.right);
      await expect(bounds.top).toBeGreaterThanOrEqual(photoBounds.bottom);
      await expect(bounds.bottom).toBeLessThan(featureBounds.bottom);
    }
    await expect(subtitle.getBoundingClientRect().top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom);
    const featureContent = within(feature);
    const time = featureContent.getByText("Singapore time:").parentElement;
    const players = featureContent.getByText("2 / 4");
    if (!time) throw new globalThis.Error("The feature time metadata was not rendered.");
    const timeBounds = time.getBoundingClientRect();
    const playerBounds = players.getBoundingClientRect();
    await expect(timeBounds.top).toBeGreaterThanOrEqual(subtitle.getBoundingClientRect().bottom);
    await expect(Math.abs(timeBounds.top + timeBounds.height / 2 - playerBounds.top - playerBounds.height / 2)).toBeLessThan(2);
    await expect(featureContent.getByText(/^Joined$/i)).toBeVisible();
    await expect(getComputedStyle(panel).borderWidth).toBe("0px");
    await expect(getComputedStyle(panel).boxShadow).toBe("none");
    await expect(getComputedStyle(panel).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    for (const row of canvas.getAllByRole("button", { name: /^Expand / })) {
      await expect(getComputedStyle(row).borderBottomWidth).toBe("0px");
      await expect(row.querySelector("img")).toBeNull();
    }
    await expectNoHorizontalOverflow();
  },
};

export const DesktopEntranceSequence: Story = {
  beforeEach: observeEntrance,
  play: async ({ canvas, canvasElement, args }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    const expanded = timeline.querySelector<HTMLElement>("[data-timeline-expanded]");
    const rail = timeline.querySelector<HTMLElement>("[data-timeline-rail]");
    if (!expanded || !rail) throw new globalThis.Error("The entrance targets were not rendered.");
    const initialHeight = expanded.getBoundingClientRect().height;
    const initialScroll = window.scrollY;
    const initialUrl = window.location.href;
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "details"), { timeout: 2000 });
    const hero = expanded.querySelector<HTMLElement>('[data-timeline-reveal="hero"]');
    const title = expanded.querySelector<HTMLElement>('[data-timeline-reveal="title"]');
    const venue = expanded.querySelector<HTMLElement>('[data-timeline-reveal="venue"]');
    const action = expanded.querySelector<HTMLElement>('[data-timeline-reveal="action"]');
    if (!hero || !title || !venue || !action) throw new globalThis.Error("The independent detail reveal targets were not rendered.");
    const delays = [hero, title, venue, action].map((target) => {
      const animation = target.getAnimations().find((animation) => animation.constructor === Animation);
      if (!animation?.effect) throw new globalThis.Error("A detail target is missing its entrance animation.");
      return animation.effect.getTiming().delay;
    });
    await expect(new Set(delays).size).toBe(4);
    await expect(delays[0]!).toBeLessThan(delays[1]!);
    await expect(delays[1]!).toBeLessThan(delays[2]!);
    await expect(delays[2]!).toBeLessThan(delays[3]!);
    await waitFor(() => {
      expect(timeline).toHaveAttribute("data-timeline-entrance", "details");
      expect(Number(getComputedStyle(hero).opacity)).toBeGreaterThan(Number(getComputedStyle(title).opacity));
    });
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "complete"), { timeout: 3000 });
    await expect(entrancePhases.filter((phase) => phase !== "pending")).toEqual(["line", "dot", "details", "complete"]);
    await expect(concealedContent.map(({ phase }) => phase)).toEqual(["line", "dot"]);
    for (const snapshot of concealedContent) {
      await expect(snapshot.opacities.length).toBeGreaterThan(10);
      await expect(snapshot.opacities.every((opacity) => opacity === "0")).toBe(true);
    }
    await expect(entranceHeights.length).toBeGreaterThanOrEqual(3);
    for (const height of entranceHeights) await expect(Math.abs(height - initialHeight)).toBeLessThan(1);
    await expect(expanded.getBoundingClientRect().height).toBe(initialHeight);
    await expect(window.scrollY).toBe(initialScroll);
    await expect(window.location.href).toBe(initialUrl);
    await expect(args.onOpenSession).not.toHaveBeenCalled();
    await expect(canvas.getByRole("button", { name: "View details" })).toBeVisible();
    await expectTimelineContentRevealed(timeline);
    await expectTimelineHierarchy(canvasElement, "2026-10-21");
  },
};

export const EntranceDetailsInterrupt: Story = {
  play: async ({ canvas }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "details"), { timeout: 2000 });
    await expect(timeline.getAnimations({ subtree: true }).some((animation) => animation.constructor === Animation && animation.playState === "running")).toBe(true);
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "complete"));
    await expectTimelineContentRevealed(timeline);
    await expect(canvas.getByRole("button", { name: "View details" })).toBeVisible();
  },
};

export const EntranceWheelInterrupt: Story = {
  play: async ({ canvas }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    await expect(timeline).not.toHaveAttribute("data-timeline-entrance", "complete");
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "complete"));
    await expect(canvas.getByRole("button", { name: "View details" })).toBeVisible();
  },
};

export const EntranceKeyboardInterrupt: Story = {
  play: async ({ canvas, canvasElement }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    await expect(timeline).not.toHaveAttribute("data-timeline-entrance", "complete");
    const date = canvas.getByRole("button", { name: "Show Tennis Court Booking, 23 Oct 2026" });
    date.focus();
    await userEvent.keyboard("{Enter}");
    await expect(timeline).toHaveAttribute("data-timeline-entrance", "complete");
    await waitFor(() => expect(date).toHaveAttribute("aria-expanded", "true"));
    await expectTimelineHierarchy(canvasElement, "2026-10-23");
  },
};

export const ReducedMotionSkipsEntrance: Story = {
  beforeEach: () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => {
      const media = originalMatchMedia.call(window, query);
      if (query.includes("prefers-reduced-motion")) Object.defineProperty(media, "matches", { value: true });
      return media;
    };
    return () => { window.matchMedia = originalMatchMedia; };
  },
  play: async ({ canvas }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    await expect(timeline).toHaveAttribute("data-timeline-entrance", "complete");
    // This boundary mock exercises the entrance hook; the browser matrix also
    // verifies native reduced-motion CSS. Ignore unrelated CSS transitions here.
    await expect(timeline.getAnimations({ subtree: true }).filter((animation) => animation.constructor === Animation && animation.playState === "running")).toHaveLength(0);
    await expect(canvas.getByRole("button", { name: "View details" })).toBeVisible();
  },
};

/** Selecting a later session keeps preceding rows compact and the active date distinct. */
export const DesktopCurrentSessionHierarchy: Story = {
  play: async ({ canvas, canvasElement }) => {
    const third = canvasElement.querySelector<HTMLElement>(`#timeline-card-${joinedSessions[2]!.sessionId}`);
    if (!third) throw new globalThis.Error("The third session card was not rendered.");
    await userEvent.click(within(third).getByRole("button", { name: "Expand Tennis Court Booking at Choa Chu Kang Tennis Centre" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 24 Oct 2026" })).toHaveAttribute("aria-expanded", "true"));
    await expectTimelineHierarchy(canvasElement, "2026-10-24");
    await expect(getComputedStyle(timelineDay(canvasElement, "2026-10-21")).color).toBe(getComputedStyle(timelineDay(canvasElement, "2026-10-23")).color);
    await expect(getComputedStyle(timelineDay(canvasElement, "2026-10-21")).color).not.toBe(getComputedStyle(timelineDay(canvasElement, "2026-10-24")).color);
    await expectNoHorizontalOverflow();
  },
};

export const DesktopHosting: Story = {
  args: { tab: "hosting", sessions: hostedSessions },
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByRole("heading", { name: "Upcoming (4)" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Past (6)" })).toBeVisible();
    const upcoming = canvas.getByRole("region", { name: "Upcoming (4)" });
    await expect(within(upcoming).getAllByRole("button", { name: /^Manage / })).toHaveLength(4);
    const past = canvas.getByRole("region", { name: "Past (6)" });
    await expect(within(past).getAllByRole("button", { name: /^View / })).toHaveLength(6);
    await expect(canvas.queryByRole("region", { name: "Joined session timeline" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Manage my places" })).not.toBeInTheDocument();
    await expect(canvasElement.querySelector("[data-timeline-marker]")).toBeNull();
    await userEvent.click(within(upcoming).getByRole("button", { name: "Manage Tennis Court Booking at Bukit Timah Community Club" }));
    await expect(args.onOpenSession).toHaveBeenCalledWith(hostedSessions[0]);
    await expectNoHorizontalOverflow();
  },
};

export const MobileJoined: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvasElement.querySelector("[data-timeline-entrance]")).toHaveAttribute("data-timeline-entrance", "complete");
    const navigation = within(canvas.getByRole("navigation", { name: "Main" }));
    await expect(navigation.getByRole("link", { name: /^Sessions$/ })).toHaveAttribute("aria-current", "page");
    const list = within(canvas.getByRole("list", { name: "Joined sessions" }));
    await expect(list.getAllByRole("listitem")).toHaveLength(10);
    const manage = canvas.getByRole("link", { name: "Manage my places" });
    await expect(manage).toHaveAttribute("href", "/sessions/joined");
    await expect(manage.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const first = list.getByRole("button", { name: "View Tennis Court Booking at Bukit Timah Community Club, 21 Oct 2026" });
    await expect(first.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(first).toHaveTextContent("7:00 PM – 8:00 PM");
    await userEvent.click(first);
    await expect(args.onOpenSession).toHaveBeenCalledWith(joinedSessions[0]);
    await expect(canvas.queryByRole("tab", { name: "Details" })).not.toBeInTheDocument();
    await expectNoHorizontalOverflow();
  },
};

export const MobileHosting: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  args: { tab: "hosting", sessions: hostedSessions },
  play: async ({ canvas }) => {
    const views = within(canvas.getByRole("navigation", { name: "Session views" }));
    await expect(views.getByRole("button", { name: /^I'm organising$/ })).toHaveAttribute("aria-current", "page");
    const list = within(canvas.getByRole("list", { name: "Hosting sessions" }));
    await expect(list.getAllByRole("listitem")).toHaveLength(10);
    await expect(views.getByRole("link", { name: "Groups" })).toHaveAttribute("href", "/groups");
    await expectNoHorizontalOverflow();
  },
};

/** A two-session example preserves the quiet composition of the mobile reference. */
export const MobileReference: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  args: { sessions: joinedSessions.slice(0, 2), upcomingCount: 2, pastCount: 0 },
  play: async ({ canvas }) => {
    await expect(within(canvas.getByRole("list", { name: "Joined sessions" })).getAllByRole("listitem")).toHaveLength(2);
    await expectNoHorizontalOverflow();
  },
};

export const DesktopDark: Story = {
  ...DesktopJoined,
  globals: { theme: "dark", viewport: { value: "desktop", isRotated: false } },
};

export const MobileDark: Story = {
  ...MobileJoined,
  globals: { theme: "dark", viewport: { value: "phone", isRotated: false } },
};

export const EmptyJoined: Story = {
  args: { sessions: [], upcomingCount: 0, pastCount: 0 },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("heading", { name: "Your sessions will appear here." })).toBeVisible();
    // A replacement invitation can exist before the player has joined anything.
    await expect(canvas.getByRole("link", { name: "Manage my places" })).toHaveAttribute("href", "/sessions/joined");
    await expect(canvas.getByRole("link", { name: "Join a session" })).toHaveAttribute("href", "/discover?returnTo=%2Fsessions");
    await expect(canvas.getByRole("link", { name: "Create a session" })).toHaveAttribute("href", "/sessions/create");
    await expect(canvas.getByRole("heading", { name: "Ideas to get started", level: 2 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Join a public session", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Create your own", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Play with a group", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /^Join a public session/ })).toHaveAttribute("href", "/discover?returnTo=%2Fsessions");
    await expect(canvas.getByRole("link", { name: /^Create your own/ })).toHaveAttribute("href", "/sessions/create");
    await expect(canvas.getByRole("link", { name: /^Play with a group/ })).toHaveAttribute("href", "/groups");
    await expect(canvas.queryByRole("region", { name: "Joined session timeline" })).not.toBeInTheDocument();
    const views = within(canvas.getByRole("navigation", { name: "Session views" }));
    await userEvent.click(views.getByRole("button", { name: "I'm organising" }));
    await expect(args.onTabChange).toHaveBeenCalledWith("hosting");
    await expectNoHorizontalOverflow();
  },
};

export const EmptyHosting: Story = {
  args: { tab: "hosting", sessions: [], upcomingCount: 0, pastCount: 0 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "You haven’t created any sessions." })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Create a session" })).toHaveAttribute("href", "/sessions/create");
    await expect(canvas.getByRole("heading", { name: "Tips to get started", level: 2 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Choose a court", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Set session details", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Invite others", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /^Choose a court/ })).toHaveAttribute("href", "/sessions/create");
    await expect(canvas.getByRole("link", { name: /^Set session details/ })).toHaveAttribute("href", "/sessions/create");
    await expect(canvas.getByRole("link", { name: /^Invite others/ })).toHaveAttribute("href", "/groups");
    await expect(canvas.getByText("No hosted sessions yet")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Join a session" })).toHaveAttribute("href", "/discover?returnTo=%2Fsessions");
    await expectNoHorizontalOverflow();
  },
};

export const MobileEmptyJoined: Story = {
  ...EmptyJoined,
  globals: { viewport: { value: "phone", isRotated: false } },
};

export const MobileEmptyHosting: Story = {
  ...EmptyHosting,
  globals: { viewport: { value: "phone", isRotated: false } },
};

export const EmptyJoinedNeedsEmail: Story = {
  args: { sessions: [], upcomingCount: 0, pastCount: 0, actions: [{ name: "add-email", href: "/profile/email", method: "GET", inputs: {} }] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Your sessions will appear here." })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Join a session" })).toHaveAttribute("href", "/discover?returnTo=%2Fsessions");
    for (const link of canvas.getAllByRole("link", { name: "Add email" })) await expect(link).toHaveAttribute("href", "/profile/email");
    await expect(canvas.getByRole("link", { name: /^Create your own/ })).toHaveAttribute("href", "/profile/email");
    await expect(canvas.queryByRole("link", { name: "Create a session" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "New session" })).not.toBeInTheDocument();
    await expectNoHorizontalOverflow();
  },
};

export const EmptyHostingNeedsEmail: Story = {
  args: { ...EmptyJoinedNeedsEmail.args, tab: "hosting" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "You haven’t created any sessions." })).toBeVisible();
    for (const link of canvas.getAllByRole("link", { name: "Add email" })) await expect(link).toHaveAttribute("href", "/profile/email");
    await expect(canvas.getByRole("link", { name: /^Choose a court/ })).toHaveAttribute("href", "/profile/email");
    await expect(canvas.getByRole("link", { name: /^Set session details/ })).toHaveAttribute("href", "/profile/email");
    await expect(canvas.queryByRole("link", { name: "Create a session" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "New session" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Join a session" })).toHaveAttribute("href", "/discover?returnTo=%2Fsessions");
    await expectNoHorizontalOverflow();
  },
};

export const EmptyHostingNeedsSetup: Story = {
  args: { tab: "hosting", sessions: [], upcomingCount: 0, pastCount: 0, actions: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Set up your account" })).toHaveAttribute("href", "/profile");
    await expect(canvas.getByRole("link", { name: /^Choose a court/ })).toHaveAttribute("href", "/profile");
    await expect(canvas.getByRole("link", { name: /^Set session details/ })).toHaveAttribute("href", "/profile");
    await expect(canvas.queryByRole("link", { name: "Create a session" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "New session" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Join a session" })).toHaveAttribute("href", "/discover?returnTo=%2Fsessions");
    await expectNoHorizontalOverflow();
  },
};

export const Loading: Story = {
  args: { sessions: [], loading: true },
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading your sessions…");
    await expectFeedSkeleton(canvasElement, "joined");
    await expect(canvas.queryByRole("heading", { name: "Your sessions will appear here." })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("region", { name: "Joined session timeline" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "New session" })).toBeVisible();
    await userEvent.click(within(canvas.getByRole("navigation", { name: "Session views" })).getByRole("button", { name: "I'm organising" }));
    await expect(args.onTabChange).toHaveBeenCalledWith("hosting");
    await expectNoHorizontalOverflow();
  },
};

export const LoadingHosting: Story = {
  args: { tab: "hosting", sessions: [], loading: true },
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading your sessions…");
    await expectFeedSkeleton(canvasElement, "hosting");
    await expect(canvas.queryByRole("heading", { name: "You haven’t created any sessions." })).not.toBeInTheDocument();
    await userEvent.click(within(canvas.getByRole("navigation", { name: "Session views" })).getByRole("button", { name: "I'm playing" }));
    await expect(args.onTabChange).toHaveBeenCalledWith("joined");
    await expectNoHorizontalOverflow();
  },
};

export const MobileLoading: Story = {
  args: Loading.args,
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading your sessions…");
    await expectFeedSkeleton(canvasElement, "joined", true);
    await expect(canvas.getByRole("navigation", { name: "Session views" })).toBeVisible();
    await expectNoHorizontalOverflow();
  },
};

export const LoadingDark: Story = {
  ...Loading,
  globals: { theme: "dark", viewport: { value: "desktop", isRotated: false } },
};

export const MobileLoadingHostingDark: Story = {
  args: LoadingHosting.args,
  globals: { theme: "dark", viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading your sessions…");
    await expectFeedSkeleton(canvasElement, "hosting", true);
    await expect(canvas.getByRole("navigation", { name: "Session views" })).toBeVisible();
    await expectNoHorizontalOverflow();
  },
};

export const Error: Story = {
  args: { sessions: [], error: "We couldn’t load your sessions. Please try again." },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("We couldn’t load your sessions.");
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
    await expectNoHorizontalOverflow();
  },
};

export const KeyboardAndSessionSummary: Story = {
  play: async ({ canvas, canvasElement, args, step }) => {
    await step("The date control expands a session with the keyboard", async () => {
      const date = canvas.getByRole("button", { name: "Show Tennis Court Booking, 23 Oct 2026" });
      date.focus();
      await userEvent.keyboard("{Enter}");
      await expect(date).toHaveAttribute("aria-expanded", "true");
      await expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 21 Oct 2026" })).toHaveAttribute("aria-expanded", "false");
      await expectTimelineHierarchy(canvasElement, "2026-10-23");
    });
    await step("The compact summary delegates details without inline panels or calendar links", async () => {
      const expanded = canvasElement.querySelector<HTMLElement>(`#timeline-card-${joinedSessions[1]!.sessionId}`);
      if (!expanded) throw new globalThis.Error("The expanded session card was not rendered.");
      const card = within(expanded);
      await expect(card.queryByRole("tablist")).not.toBeInTheDocument();
      await expect(card.queryByRole("link", { name: /View in calendar/ })).not.toBeInTheDocument();
      await expect(card.getByText("3 / 4")).toBeVisible();
      await expect(card.getByText("3 / 4")).toHaveTextContent("3 / 4 players");
      await userEvent.click(card.getByRole("button", { name: "View details" }));
      await expect(args.onOpenSession).toHaveBeenCalledWith(joinedSessions[1]);
    });
    await step("The hosting tab delegates the controlled tab change", async () => {
      const views = within(canvas.getByRole("navigation", { name: "Session views" }));
      await userEvent.click(views.getByRole("button", { name: /^I'm organising$/ }));
      await expect(args.onTabChange).toHaveBeenCalledWith("hosting");
    });
    await step("A selected historical date stays subdued while gaining the current date size", async () => {
      const pastDay = timelineDay(canvasElement, "2026-10-20");
      const historicalColor = getComputedStyle(pastDay).color;
      await userEvent.click(canvas.getByRole("button", { name: "Show Tennis Court Booking, 20 Oct 2026" }));
      await expectTimelineHierarchy(canvasElement, "2026-10-20");
      await expect(getComputedStyle(pastDay).color).toBe(historicalColor);
    });
    await expectNoHorizontalOverflow();
  },
};

/** A neutral full feed for native wheel and explicit-selection coverage. */
export const DesktopWheelNavigation: Story = {};

export const NativeScrollSettlesOnSession: Story = {
  play: async ({ canvas }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "complete"), { timeout: 3000 });
    const initialHeight = timeline.getBoundingClientRect().height;
    const initialScroll = window.scrollY;
    window.scrollBy({ top: 144, behavior: "instant" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await expect(window.scrollY).toBeGreaterThan(initialScroll);
    await expect(canvas.queryByRole("button", { name: "View details" })).not.toBeInTheDocument();
    await expect(Math.abs(timeline.getBoundingClientRect().height - initialHeight)).toBeLessThan(1);
    await waitFor(() => expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 21 Oct 2026" })).toHaveAttribute("aria-expanded", "true"));
    await waitFor(() => expect(Math.abs(window.scrollY - initialScroll)).toBeLessThan(1));
    await expectNoHorizontalOverflow();
  },
};

export const DirectWheelSelection: Story = {
  play: async ({ canvas, canvasElement }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "complete"), { timeout: 3000 });
    const passed = timeline.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true }));
    await expect(passed).toBe(false);
    await expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 23 Oct 2026" })).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      for (const row of timeline.querySelectorAll<HTMLElement>("[data-session-id]")) {
        expect(Number(row.style.getPropertyValue("--expansion"))).toBe(0);
      }
    });
    await waitFor(() => expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 23 Oct 2026" })).toHaveAttribute("aria-expanded", "true"));
    await expectTimelineHierarchy(canvasElement, "2026-10-23");
  },
};

export const KeyboardNavigatesTimeline: Story = {
  play: async ({ canvas, canvasElement }) => {
    canvas.getByRole("button", { name: "Show Tennis Court Booking, 21 Oct 2026" }).focus();
    for (const [key, date] of [["{ArrowDown}", "23 Oct 2026"], ["{PageDown}", "24 Oct 2026"], ["{ArrowUp}", "23 Oct 2026"], ["{PageUp}", "21 Oct 2026"], ["{Home}", "3 Oct 2026"], ["{End}", "25 Oct 2026"]]) {
      await userEvent.keyboard(key!);
      const selected = canvas.getByRole("button", { name: `Show Tennis Court Booking, ${date}` });
      await waitFor(() => expect(selected).toHaveAttribute("aria-expanded", "true"));
      await expect(selected).toHaveFocus();
    }
    await expectTimelineHierarchy(canvasElement, "2026-10-25");
    await expectNoHorizontalOverflow();
  },
};

export const TallViewportDateNavigation: Story = {
  globals: { viewport: { value: "tallDesktop", isRotated: false } },
  parameters: {
    viewport: { options: { tallDesktop: { name: "Tall desktop (1440px)", styles: { width: "1440px", height: "1800px" }, type: "desktop" } } },
  },
  play: async ({ canvas, canvasElement }) => {
    const timeline = canvas.getByRole("region", { name: "Joined session timeline" });
    await waitFor(() => expect(timeline).toHaveAttribute("data-timeline-entrance", "complete"), { timeout: 3000 });
    await userEvent.click(canvas.getByRole("button", { name: "Show Tennis Court Booking, 23 Oct 2026" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Show Tennis Court Booking, 23 Oct 2026" })).toHaveAttribute("aria-expanded", "true"));
    await expectTimelineHierarchy(canvasElement, "2026-10-23");
    await expectNoHorizontalOverflow();
  },
};

export const InfiniteScrollRequestsNextPage: Story = {
  args: { hasMore: true },
  play: async ({ canvas, args }) => {
    await waitFor(() => expect(canvas.getByRole("region", { name: "Joined session timeline" })).toHaveAttribute("data-timeline-entrance", "complete"), { timeout: 3000 });
    const more = canvas.getByRole("button", { name: "Load more sessions" });
    await expect(args.onLoadMore).not.toHaveBeenCalled();
    // The native page scroll reaches pagination independently of selection.
    canvas.getByRole("button", { name: "Show Tennis Court Booking, 21 Oct 2026" }).focus();
    more.scrollIntoView({ block: "center", behavior: "instant" });
    await waitFor(() => expect(args.onLoadMore).toHaveBeenCalled());
    await expectNoHorizontalOverflow();
  },
};

export const LoadingMore: Story = {
  args: { hasMore: true, loadingMore: true },
  play: async ({ canvas, args }) => {
    const loading = canvas.getByRole("button", { name: "Loading sessions…" });
    loading.scrollIntoView({ block: "center", behavior: "instant" });
    await expect(loading).toBeDisabled();
    await expect(args.onLoadMore).not.toHaveBeenCalled();
  },
};

export const NextPageError: Story = {
  args: { hasMore: true, error: "We couldn’t load more sessions. Please try again." },
  play: async ({ canvas, args }) => {
    canvas.getByRole("button", { name: "Show Tennis Court Booking, 21 Oct 2026" }).focus();
    await waitFor(() => expect(canvas.getByRole("heading", { name: "This week" })).toBeVisible());
    await expect(canvas.getByRole("alert")).toHaveTextContent("We couldn’t load more sessions.");
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
    await expect(args.onLoadMore).not.toHaveBeenCalled();
  },
};
