import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoveryFormController } from "./discovery-form-controller";

const meta = {
  title: "Discovery/Form transitions",
  component: DiscoveryFormController,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Exercises the same local transitions used in production, replacing only router navigation with callbacks. Local feedback is idle or invalid. The mobile filter panel is collapsed or expanded, initially expanded for invalid URL queries. Collapsing preserves drafts; applied summaries derive from URL props. Editing clears local errors, valid submission resets pagination, and loading disables changes. Browser tests cover committed URL changes, server outcomes, and history restoration." } },
  },
  args: { filters: emptyFilters, outcome: { status: "ready", page: examplePage }, pending: false, onNavigate: fn(), onRefresh: fn() },
} satisfies Meta<typeof DiscoveryFormController>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ApplyFilters: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.selectOptions(canvas.getByLabelText("Sport"), "Badminton");
    await userEvent.selectOptions(canvas.getByLabelText("Region"), "Central");
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await expect(canvas.getByRole("heading", { name: "Tampines Hub" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("sport=Badminton&region=Central");
  },
};

export const CorrectValidation: Story = {
  args: { filters: { ...emptyFilters, timeFrom: "18:00" } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(canvas.getByLabelText("Date")).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByRole("alert")).toBeVisible();
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await userEvent.clear(canvas.getByLabelText("From"));
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Bishan Sports Hall" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("");
  },
};

export const ClearDraft: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.selectOptions(canvas.getByLabelText("Sport"), "Badminton");
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
    await expect(canvas.getByLabelText("Sport")).toHaveValue("");
    await expect(args.onNavigate).toHaveBeenCalledWith("");
  },
};

export const NextKeepsAppliedFilters: Story = {
  args: { filters: { ...emptyFilters, region: "East" }, outcome: { status: "ready", page: { ...examplePage, nextCursor: "page-two" } } },
  play: async ({ canvas, args }) => {
    await userEvent.selectOptions(canvas.getByLabelText("Sport"), "Tennis");
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("region=East&cursor=page-two");
  },
};

export const RetryCommittedQuery: Story = {
  args: { outcome: { status: "error", kind: "unexpected" } },
  play: async ({ canvas, args }) => {
    await userEvent.selectOptions(canvas.getByLabelText("Region"), "East");
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRefresh).toHaveBeenCalledOnce();
    await expect(args.onNavigate).not.toHaveBeenCalled();
  },
};

export const PendingNavigation: Story = {
  args: { pending: true, outcome: { status: "ready", page: { ...examplePage, nextCursor: "page-two" } } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Clear filters" })).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
    await expect(args.onNavigate).not.toHaveBeenCalled();
    await expect(args.onRefresh).not.toHaveBeenCalled();
  },
};
