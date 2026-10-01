import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Money } from "./money";

const meta = {
  title: "Design system/Money",
  component: Money,
  parameters: {
    docs: {
      description: {
        component:
          "Shows an SGD amount with two decimals, e.g. `1250` → **S$12.50**. Money is always **integer cents** in " +
          "this project; this component only formats it for display and throws on anything that isn't a whole " +
          "number of cents.",
      },
    },
  },
  argTypes: {
    cents: {
      control: { type: "number", step: 1 },
      description: "Amount in integer SGD cents (1250 = S$12.50). Must be a whole number.",
    },
    className: { control: "text", description: "Extra Tailwind classes, e.g. `text-3xl font-bold`." },
  },
  args: { cents: 1250 },
} satisfies Meta<typeof Money>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Change the cents in Controls and watch the formatting. */
export const Playground: Story = {};

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