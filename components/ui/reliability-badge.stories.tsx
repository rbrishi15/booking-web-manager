import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ReliabilityBadge } from "./reliability-badge";

/** The domain score is 0–100; the mockups show it out of 5 with a label. */
const meta = {
  title: "Design system/ReliabilityBadge",
  component: ReliabilityBadge,
  args: { score: 96 },
  argTypes: { score: { control: { type: "range", min: 0, max: 100, step: 1 } } },
} satisfies Meta<typeof ReliabilityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const High: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Reliability 4.8 / High")).toBeInTheDocument();
  },
};

export const Medium: Story = {
  args: { score: 75 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Reliability 3.8 / Medium")).toBeInTheDocument();
  },
};

export const Low: Story = {
  args: { score: 40 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Reliability 2.0 / Low")).toBeInTheDocument();
  },
};