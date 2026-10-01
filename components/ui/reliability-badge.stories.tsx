import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ReliabilityBadge } from "./reliability-badge";

const meta = {
  title: "Design system/ReliabilityBadge",
  component: ReliabilityBadge,
  parameters: {
    docs: {
      description: {
        component:
          "Shows a player's reliability. The domain score is 0–100; the mockups show it out of 5 with a label: " +
          "**High** from 90, **Medium** from 70, **Low** below that (thresholds are placeholders until Rishi confirms).",
      },
    },
  },
  argTypes: {
    score: {
      control: { type: "range", min: 0, max: 100, step: 1 },
      description: "The domain reliability score, 0–100. Shown as score ÷ 20 (e.g. 96 → 4.8).",
    },
    className: { control: false },
  },
  args: { score: 96 },
} satisfies Meta<typeof ReliabilityBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Drag the score slider in Controls to see the label and colour change at 70 and 90. */
export const Playground: Story = {};

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