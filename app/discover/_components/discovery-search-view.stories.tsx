import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoverySearchView } from "./discovery-search-view";

const meta = {
  title: "Discover/Search view",
  component: DiscoverySearchView,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "The synchronous Discover search view has four exclusive screen states: loading, ready, invalid, and error. Results and applied filters come from server props; search and advanced-filter drafts stay in one mounted uncontrolled form. The collapsed/expanded disclosure is presentation state owned by the controller. Search and sport chips submit drafts; pagination preserves applied URL filters. No database or authentication dependencies are required to render these stories." } },
  },
  globals: { viewport: { value: "phone", isRotated: false } },
  args: {
    filters: emptyFilters,
    state: { status: "ready", page: examplePage },
    filterPanel: "collapsed",
    returnTo: "/?region=East",
    onToggleFilters: fn(), onApply: fn(), onEdit: fn(), onClear: fn(), onNext: fn(), onRetry: fn(),
  },
} satisfies Meta<typeof DiscoverySearchView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Find Your Next Game" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Back to previous page" })).toHaveAttribute("href", "/?region=East");
    await expect(canvas.getByRole("button", { name: "All sports" })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("heading", { name: "Badminton session" })).toBeVisible();
  },
};
export const ExpandedFilters: Story = { args: { filterPanel: "expanded" } };
export const Empty: Story = { args: { state: { status: "ready", page: { items: [], nextCursor: null } } } };
export const Loading: Story = {
  args: { state: { status: "loading" }, filterPanel: "expanded" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("searchbox")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Search" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Filters" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Tennis" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Clear filters" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    await expect(canvas.getByRole("region", { name: "Upcoming sessions" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading sessions");
    await expect(canvas.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  },
};
export const Invalid: Story = { args: { filterPanel: "expanded", filters: { ...emptyFilters, timeFrom: "18:00" }, state: { status: "invalid", fieldErrors: { date: ["Choose a date when filtering by time"] } } } };
export const InvalidSearch: Story = { args: { filterPanel: "expanded", filters: { ...emptyFilters, q: "A".repeat(101) }, state: { status: "invalid", fieldErrors: { q: ["Search must be 100 characters or fewer"] } } } };
export const Unavailable: Story = { args: { state: { status: "error", kind: "unavailable" } } };
export const UnexpectedFailure: Story = {
  args: { state: { status: "error", kind: "unexpected" } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
export const Pagination: Story = {
  args: { state: { status: "ready", page: { ...examplePage, nextCursor: "next-page" } } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await expect(args.onNext).toHaveBeenCalledWith("next-page");
  },
};
export const LongVenueName: Story = {
  args: { state: { status: "ready", page: { items: [{ ...examplePage.items[0]!, venueName: "Singapore Community Sports and Recreation Centre — Indoor Multi-purpose Badminton Hall, Level 4, Court 12" }], nextCursor: null } } },
};
export const Overnight: Story = {
  args: { state: { status: "ready", page: { items: [{ ...examplePage.items[1]!, startAt: "2035-12-31T15:00:00.000Z", endAt: "2035-12-31T17:00:00.000Z" }], nextCursor: null } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("31 Dec 2035", { selector: "time" })).toBeVisible();
    await expect(canvas.getByText(/1 Jan 2036/, { selector: "time" })).toBeVisible();
  },
};
export const Dark: Story = { globals: { theme: "dark" } };
