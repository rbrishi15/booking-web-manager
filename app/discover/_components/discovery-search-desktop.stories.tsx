import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoveryFormController } from "./discovery-form-controller";

const meta = {
  title: "Discover/Desktop search page",
  component: DiscoveryFormController,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/discover" } },
    docs: { description: { component: "Desktop Discover keeps the Booking sidebar and a distinct active Discover destination. The centered search column shares the mobile form, disclosure, state transitions, and compact results. Home shows only personal upcoming bookings or the weather fallback." } },
  },
  globals: { viewport: { value: "desktop", isRotated: false } },
  decorators: [(Story) => <AppShell mobileVariant="focused" user={{ name: "Marcus Lim", reliabilityScore: 96 }} logoutAction={fn()}><Story /></AppShell>],
  args: { returnTo: "/", filters: emptyFilters, outcome: { status: "ready", page: examplePage }, pending: false, onNavigate: fn(), onRefresh: fn() },
} satisfies Meta<typeof DiscoveryFormController>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("navigation", { name: "Main" }).querySelector('[aria-current="page"]')).toHaveTextContent("Discover");
    await expect(canvas.getByRole("heading", { name: "Find Your Next Game" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Badminton session" })).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const Filtered: Story = { args: { filters: { ...emptyFilters, q: "Bishan", sport: "Badminton", region: "Central" }, outcome: { status: "ready", page: { items: [examplePage.items[0]!], nextCursor: null } } } };
export const Invalid: Story = { args: { filters: { ...emptyFilters, timeFrom: "18:00" }, outcome: { status: "invalid", fieldErrors: { date: ["Choose a date when filtering by time"] } } } };
export const Loading: Story = { args: { pending: true } };
export const Unavailable: Story = { args: { outcome: { status: "error", kind: "unavailable" } } };
export const LongVenueName: Story = { args: { outcome: { status: "ready", page: { items: [{ ...examplePage.items[0]!, venueName: "Singapore Community Sports and Recreation Centre — Indoor Multi-purpose Badminton Hall, Level 4, Court 12" }], nextCursor: null } } } };
export const Dark: Story = { globals: { theme: "dark" } };
