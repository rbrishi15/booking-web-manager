import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusBadge } from "./status-badge";

const meta = {
  title: "Design system/StatusBadge",
  component: StatusBadge,
  args: { tone: "success", children: "Confirmed" },
  argTypes: { tone: { control: "select", options: ["success", "info", "neutral", "danger"] } },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};

export const Info: Story = { args: { tone: "info", children: "Owner" } };

export const Neutral: Story = { args: { tone: "neutral", children: "Archived" } };

export const Danger: Story = { args: { tone: "danger", children: "Forfeited" } };