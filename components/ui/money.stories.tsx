import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Money } from "./money";

/** Money is always integer cents; this component only formats it for display. */
const meta = {
  title: "Design system/Money",
  component: Money,
  args: { cents: 1250 },
} satisfies Meta<typeof Money>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BookingShare: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("S$12.50")).toBeInTheDocument();
  },
};

export const Zero: Story = {
  args: { cents: 0 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("S$0.00")).toBeInTheDocument();
  },
};

export const Large: Story = {
  args: { cents: 123456789, className: "text-3xl font-bold" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("S$1,234,567.89")).toBeInTheDocument();
  },
};