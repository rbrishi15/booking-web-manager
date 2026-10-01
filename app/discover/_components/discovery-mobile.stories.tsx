import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoveryFormController } from "./discovery-form-controller";
import type { DiscoveryOutcome } from "./discovery-state";

const meta = {
  title: "Home/Mobile page",
  component: DiscoveryFormController,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/" } },
    docs: { description: { component: "The production shell and discovery controller at 390px. Sport photos are decorative; cards remain informational. Filters are a mounted disclosure, independent of loading/ready/invalid/error screen states. Each committed URL remounts the controller: valid queries start collapsed, invalid queries start expanded. The Desktop page stories show the corresponding sidebar layout with always-visible filters." } },
  },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Marcus Lim", reliabilityScore: 96 }} logoutAction={fn()}><Story /></AppShell>],
  args: { filters: emptyFilters, outcome: { status: "ready", page: examplePage }, pending: false, onNavigate: fn(), onRefresh: fn() },
} satisfies Meta<typeof DiscoveryFormController>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByLabelText("Sport")).not.toBeVisible();
    await expect(canvas.getByText("Bishan Sports Hall", { exact: true })).toBeVisible();
    await expect(canvas.getByRole("navigation", { name: "Main" }).querySelector('[aria-current="page"]')).toHaveTextContent("Home");
    const photo = canvasElement.querySelector<HTMLImageElement>('li img');
    await expect(photo).not.toBeNull();
    await waitFor(() => expect(photo!.complete && photo!.naturalWidth > 0).toBe(true));
    await expect(photo).toHaveAttribute("alt", "");
  },
};

export const FiltersPreserveDraft: Story = {
  args: { filters: { ...emptyFilters, region: "East" } },
  play: async ({ canvas, args }) => {
    const toggle = canvas.getByRole("button", { name: "Filters" });
    await userEvent.click(toggle);
    await userEvent.selectOptions(canvas.getByLabelText("Sport"), "Tennis");
    await userEvent.click(toggle);
    await expect(canvas.getByLabelText("Sport")).not.toBeVisible();
    await expect(canvas.getByLabelText("Applied filters")).toHaveTextContent(/^East$/);
    await userEvent.click(toggle);
    await expect(canvas.getByLabelText("Sport")).toHaveValue("Tennis");
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("sport=Tennis&region=East");
  },
};

export const ValidationCorrection: Story = {
  args: { filters: { ...emptyFilters, timeFrom: "18:00" } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Filters" }));
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(canvas.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByLabelText("Date")).toHaveAttribute("aria-invalid", "true");
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await userEvent.clear(canvas.getByLabelText("From"));
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("From")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("");
  },
};

export const InvalidQuery: Story = {
  args: { filters: { ...emptyFilters, timeFrom: "18:00" }, outcome: { status: "invalid", fieldErrors: { date: ["Choose a date when filtering by time"] } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByLabelText("Date")).toBeVisible();
    await expect(canvas.getByRole("alert")).toBeVisible();
  },
};

export const RetryRevealsInvalidQuery: Story = {
  args: { filters: { ...emptyFilters, timeFrom: "18:00" } },
  render: function RetryOutcome(args) {
    const [outcome, setOutcome] = useState<DiscoveryOutcome>({ status: "error", kind: "unexpected" });
    return <DiscoveryFormController {...args} outcome={outcome} onRefresh={() => setOutcome({ status: "invalid", fieldErrors: { date: ["Choose a date when filtering by time"] } })} />;
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Date")).not.toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(canvas.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByLabelText("Date")).toBeVisible();
    await expect(canvas.getByLabelText("Date")).toHaveAttribute("aria-invalid", "true");
  },
};

export const Loading: Story = {
  args: { pending: true },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("button", { name: "Filters" })).toBeDisabled();
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading sessions");
    await expect(canvas.getByRole("region", { name: "Upcoming sessions" })).toHaveAttribute("aria-busy", "true");
    await expect(args.onNavigate).not.toHaveBeenCalled();
  },
};

export const Empty: Story = { args: { outcome: { status: "ready", page: { items: [], nextCursor: null } } } };
export const Unavailable: Story = { args: { outcome: { status: "error", kind: "unavailable" } } };
export const UnexpectedFailure: Story = {
  args: { outcome: { status: "error", kind: "unexpected" } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRefresh).toHaveBeenCalledOnce();
  },
};
export const Pagination: Story = {
  args: { outcome: { status: "ready", page: { ...examplePage, nextCursor: "next-page" } } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("cursor=next-page");
  },
};
export const LongVenueName: Story = {
  args: { outcome: { status: "ready", page: { items: [{ ...examplePage.items[0]!, venueName: "Singapore Community Sports and Recreation Centre — Indoor Multi-purpose Badminton Hall, Level 4, Court 12" }], nextCursor: null } } },
};
export const Overnight: Story = {
  args: { outcome: { status: "ready", page: { items: [{ ...examplePage.items[1]!, startAt: "2035-12-31T15:00:00.000Z", endAt: "2035-12-31T17:00:00.000Z" }], nextCursor: null } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: /31 Dec 2035 · Tennis/ })).toBeVisible();
    await expect(canvas.getAllByText(/1 Jan 2036/, { selector: "time" }).filter((element) => element.checkVisibility())).toHaveLength(1);
  },
};
export const Dark: Story = { globals: { theme: "dark" } };
