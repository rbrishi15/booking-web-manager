import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { LoadingSpinner } from "./loading-spinner";

const meta = {
  title: "Design system/LoadingSpinner",
  component: LoadingSpinner,
  parameters: {
    docs: {
      description: {
        component:
          "Shown while data loads. It has `role=\"status\"` so screen readers read the label, and the spinner " +
          "only spins when the user hasn't asked for reduced motion.",
      },
    },
  },
  argTypes: {
    label: { control: "text", description: "What is loading.", table: { defaultValue: { summary: "Loading…" } } },
    className: { control: false },
  },
  args: { label: "Loading sessions…" },
} satisfies Meta<typeof LoadingSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit the label in Controls. */
export const Playground: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(args.label ?? "Loading…");
  },
};

export const DefaultLabel: Story = {
  args: { label: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading…");
  },
};