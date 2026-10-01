import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoveryView } from "./discovery-view";

const meta = {
  title: "Discovery/Screen states",
  component: DiscoveryView,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "The screen is a tagged union: loading, ready, invalid, or error (unavailable/unexpected). Empty results and pagination are derived from ready data. Applied filters and results belong to the URL/server; form fields hold only unsubmitted edits. Apply starts a navigation, Clear returns to the unfiltered first page, Next preserves applied filters, and Retry reloads the committed query. The Form transitions stories exercise the production local controller." } },
  },
  args: {
    filters: emptyFilters,
    state: { status: "ready", page: examplePage },
    filterPanel: "collapsed",
    onApply: fn(), onEdit: fn(), onClear: fn(), onNext: fn(), onRetry: fn(), onToggleFilters: fn(),
  },
} satisfies Meta<typeof DiscoveryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "12 May 2035 · Badminton" })).toBeVisible();
    await expect(canvas.getByText("Bishan Sports Hall", { exact: true })).toBeVisible();
    await expect(canvas.getByText("S$7.50")).toBeVisible();
    await expect(canvas.getAllByText("Total capacity")).toHaveLength(2);
  },
};

export const Empty: Story = { args: { state: { status: "ready", page: { items: [], nextCursor: null } } } };

export const Loading: Story = {
  args: { state: { status: "loading" } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading sessions");
    await expect(canvas.getByRole("region", { name: "Upcoming sessions" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Clear filters" })).toBeDisabled();
    await expect(canvas.getByLabelText("Sport")).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
    await expect(args.onApply).not.toHaveBeenCalled();
  },
};

export const InvalidFilters: Story = {
  args: { filterPanel: "expanded", filters: { ...emptyFilters, timeFrom: "18:00" }, state: { status: "invalid", fieldErrors: { date: ["Choose a date when filtering by time"] } } },
};

export const Unavailable: Story = { args: { state: { status: "error", kind: "unavailable" } } };

export const UnexpectedFailure: Story = {
  args: { state: { status: "error", kind: "unexpected" } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const Pagination: Story = {
  args: { state: { status: "ready", page: { ...examplePage, nextCursor: "next-page-cursor" } } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await expect(args.onNext).toHaveBeenCalledWith("next-page-cursor");
  },
};

export const LongVenueNames: Story = {
  args: { state: { status: "ready", page: { items: [{ ...examplePage.items[0]!, venueName: "Singapore Community Sports and Recreation Centre — Indoor Multi-purpose Badminton Hall, Level 4, Court 12" }], nextCursor: null } } },
};

export const Mobile: Story = { ...LongVenueNames, globals: { viewport: { value: "phone", isRotated: false } } };
export const Dark: Story = { globals: { theme: "dark" } };
