import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoveryFormController } from "./discovery-form-controller";

const meta = {
  title: "Home/Desktop page",
  component: DiscoveryFormController,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/" } },
    docs: { description: { component: "The Booking desktop composition uses the production shell, court backdrop, always-visible filters and two-column photo cards. It shares the mobile controller and its loading/ready/invalid/error outcomes; resizing never replaces the form or its draft. Cards display public session information, including total capacity and the SGD share per person. Personal bookings and booking actions remain separate features." } },
  },
  globals: { viewport: { value: "desktop", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Marcus Lim", reliabilityScore: 96 }} logoutAction={fn()}><Story /></AppShell>],
  args: { filters: emptyFilters, outcome: { status: "ready", page: examplePage }, pending: false, onNavigate: fn(), onRefresh: fn() },
} satisfies Meta<typeof DiscoveryFormController>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("heading", { name: "Booking." })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Discover sessions" })).toBeVisible();
    await expect(canvas.getByLabelText("Sport")).toBeVisible();
    await expect(canvas.getByRole("navigation", { name: "Main" }).querySelector('[aria-current="page"]')).toHaveTextContent("Home");
    const photos = [...canvasElement.querySelectorAll<HTMLImageElement>('li img')];
    await expect(photos).toHaveLength(2);
    await waitFor(() => expect(photos.every((photo) => photo.complete && photo.naturalWidth > 0)).toBe(true), { timeout: 5000 });
  },
};

export const Empty: Story = { args: { outcome: { status: "ready", page: { items: [], nextCursor: null } } } };
export const Loading: Story = {
  args: { pending: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Sport")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    await expect(canvas.getByRole("region", { name: "Upcoming sessions" })).toHaveAttribute("aria-busy", "true");
  },
};
export const Invalid: Story = { args: { filters: { ...emptyFilters, timeFrom: "18:00" }, outcome: { status: "invalid", fieldErrors: { date: ["Choose a date when filtering by time"] } } } };
export const Unavailable: Story = { args: { outcome: { status: "error", kind: "unavailable" } } };
export const UnexpectedFailure: Story = { args: { outcome: { status: "error", kind: "unexpected" } } };
export const Pagination: Story = { args: { outcome: { status: "ready", page: { ...examplePage, nextCursor: "next-page" } } } };
export const LongVenueName: Story = { args: { outcome: { status: "ready", page: { ...examplePage, items: [{ ...examplePage.items[0]!, venueName: "Singapore Community Sports and Recreation Centre — Indoor Multi-purpose Badminton Hall, Level 4, Court 12" }, examplePage.items[1]!] } } } };
export const Overnight: Story = {
  args: { outcome: { status: "ready", page: { items: [{ ...examplePage.items[1]!, startAt: "2035-12-31T15:00:00.000Z", endAt: "2035-12-31T17:00:00.000Z" }], nextCursor: null } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "31 Dec 2035 · Tennis" })).toBeVisible();
    await expect(canvas.getByText(/1 Jan 2036/, { selector: "time" })).toBeVisible();
  },
};
export const Dark: Story = { globals: { theme: "dark" } };
