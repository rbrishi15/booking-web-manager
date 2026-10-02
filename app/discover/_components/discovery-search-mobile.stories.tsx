import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoveryFormController } from "./discovery-form-controller";

const meta = {
  title: "Discover/Mobile search page",
  component: DiscoveryFormController,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/discover" } },
    docs: { description: { component: "The dedicated 390px search composition uses the production focused shell, controller, and synchronous view. Back returns to the originating page and query. Applied URL filters and results remain unchanged during draft edits. Search edits clear local validation without expanding advanced filters. Chips submit the current drafts with the chosen sport. Browser tests verify router replacement, URL commits, server outcomes, and back/forward restoration." } },
  },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell mobileVariant="focused" user={{ name: "Marcus Lim", reliabilityScore: 96 }} logoutAction={fn()}><Story /></AppShell>],
  args: { returnTo: "/?region=East", filters: emptyFilters, outcome: { status: "ready", page: examplePage }, pending: false, onNavigate: fn(), onRefresh: fn() },
} satisfies Meta<typeof DiscoveryFormController>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("heading", { name: "Find Your Next Game" })).toBeVisible();
    await expect(canvas.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Open account menu" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Back to previous page" })).toHaveAttribute("href", "/?region=East");
    const photos = [...canvasElement.querySelectorAll<HTMLImageElement>("li img")];
    await expect(photos).toHaveLength(2);
    await waitFor(() => expect(photos.every((photo) => photo.complete && photo.naturalWidth > 0)).toBe(true));
    for (const photo of photos) await expect(photo).toHaveAttribute("alt", "");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const SearchWithoutExpandingFilters: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByRole("searchbox"), "Bishan");
    await expect(canvas.getByLabelText("Region")).not.toBeVisible();
    await expect(canvas.getByLabelText("Applied filters")).toHaveTextContent("All upcoming public sessions");
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("q=Bishan");
  },
};

export const EnterSubmitsSearch: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByRole("searchbox"), "Tampines{Enter}");
    await expect(args.onNavigate).toHaveBeenCalledWith("q=Tampines");
  },
};

export const SportChipIncludesDrafts: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByRole("searchbox"), "Hub");
    await userEvent.click(canvas.getByRole("button", { name: "Filters" }));
    await userEvent.selectOptions(canvas.getByLabelText("Region"), "East");
    await userEvent.click(canvas.getByRole("button", { name: "Filters" }));
    await userEvent.click(canvas.getByRole("button", { name: "Tennis" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("q=Hub&sport=Tennis&region=East");
  },
};

export const DisclosurePreservesDrafts: Story = {
  play: async ({ canvas, args }) => {
    const toggle = canvas.getByRole("button", { name: "Filters" });
    await userEvent.type(canvas.getByRole("searchbox"), "Bishan");
    await userEvent.click(toggle);
    await userEvent.selectOptions(canvas.getByLabelText("Sport"), "Badminton");
    await userEvent.selectOptions(canvas.getByLabelText("Region"), "Central");
    await userEvent.click(toggle);
    await expect(canvas.getByLabelText("Sport")).not.toBeVisible();
    await userEvent.click(toggle);
    await expect(canvas.getByRole("searchbox")).toHaveValue("Bishan");
    await expect(canvas.getByLabelText("Sport")).toHaveValue("Badminton");
    await expect(canvas.getByLabelText("Region")).toHaveValue("Central");
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("q=Bishan&sport=Badminton&region=Central");
  },
};

export const ValidationCorrection: Story = {
  args: { filters: { ...emptyFilters, timeFrom: "18:00" } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));
    await expect(canvas.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByLabelText("Date")).toHaveAttribute("aria-invalid", "true");
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await userEvent.clear(canvas.getByLabelText("From"));
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Date")).not.toHaveAttribute("aria-invalid");
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("");
  },
};

export const ClearDrafts: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByRole("searchbox"), "Bishan");
    await userEvent.click(canvas.getByRole("button", { name: "Filters" }));
    await userEvent.selectOptions(canvas.getByLabelText("Sport"), "Badminton");
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
    await expect(canvas.getByRole("searchbox")).toHaveValue("");
    await expect(canvas.getByLabelText("Sport")).toHaveValue("");
    await expect(args.onNavigate).toHaveBeenCalledWith("");
  },
};

export const NextKeepsAppliedSearch: Story = {
  args: { filters: { ...emptyFilters, q: "Hub", region: "East" }, outcome: { status: "ready", page: { ...examplePage, nextCursor: "next-page" } } },
  play: async ({ canvas, args }) => {
    await userEvent.clear(canvas.getByRole("searchbox"));
    await userEvent.type(canvas.getByRole("searchbox"), "Unsubmitted");
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("q=Hub&region=East&cursor=next-page");
  },
};

export const RetryCommittedSearch: Story = {
  args: { filters: { ...emptyFilters, q: "Hub" }, outcome: { status: "error", kind: "unexpected" } },
  play: async ({ canvas, args }) => {
    await userEvent.clear(canvas.getByRole("searchbox"));
    await userEvent.type(canvas.getByRole("searchbox"), "Unsubmitted");
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRefresh).toHaveBeenCalledOnce();
    await expect(args.onNavigate).not.toHaveBeenCalled();
  },
};
export const Loading: Story = {
  args: { pending: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("searchbox")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Filters" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Tennis" })).toBeDisabled();
  },
};
export const InvalidQuery: Story = { args: { filters: { ...emptyFilters, timeFrom: "18:00" }, outcome: { status: "invalid", fieldErrors: { date: ["Choose a date when filtering by time"] } } } };
export const Empty: Story = { args: { outcome: { status: "ready", page: { items: [], nextCursor: null } } } };
export const Unavailable: Story = { args: { outcome: { status: "error", kind: "unavailable" } } };
export const Dark: Story = { globals: { theme: "dark" } };
