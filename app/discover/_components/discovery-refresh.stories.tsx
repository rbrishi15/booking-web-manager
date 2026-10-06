import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent } from "storybook/test";
import { Button } from "@/components/ui/button";
import { emptyFilters, examplePage } from "./discovery-fixtures";
import { DiscoveryFormController } from "./discovery-form-controller";

/** Simulates new server results while keeping the discovery form mounted to test draft preservation. */
function RefreshedDiscovery() {
  const [page, setPage] = useState(examplePage);
  return <>
    <Button onClick={() => setPage({ items: examplePage.items.slice(1), nextCursor: null })}>Simulate server refresh</Button>
    <DiscoveryFormController filters={emptyFilters} outcome={{ status: "ready", page }} pending={false} onNavigate={fn()} onRefresh={fn()} />
  </>;
}

const meta = {
  title: "Discover/Background refresh",
  component: RefreshedDiscovery,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RefreshedDiscovery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PreservesDrafts: Story = {
  play: async ({ canvas }) => {
    const search = canvas.getByRole("searchbox");
    await userEvent.type(search, "Unsubmitted venue");
    await userEvent.click(canvas.getByRole("button", { name: "Filters" }));
    await userEvent.selectOptions(canvas.getByLabelText("Region"), "West");
    await userEvent.type(canvas.getByLabelText("Date"), "2035-05-12");
    await expect(canvas.getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(canvas.getByRole("button", { name: "Simulate server refresh" }));
    await expect(canvas.getAllByRole("listitem")).toHaveLength(1);
    await expect(search).toHaveValue("Unsubmitted venue");
    await expect(search).toBeEnabled();
    await expect(canvas.getByLabelText("Region")).toHaveValue("West");
    await expect(canvas.getByLabelText("Date")).toHaveValue("2035-05-12");
    await expect(canvas.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("region", { name: "Upcoming sessions" })).toHaveAttribute("aria-busy", "false");
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
  },
};
