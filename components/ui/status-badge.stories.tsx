import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { StatusBadge } from "./status-badge";

const TONES = ["success", "info", "neutral", "danger"] as const;

const meta = {
  title: "Design system/StatusBadge",
  component: StatusBadge,
  parameters: {
    docs: {
      description: {
        component:
          "A small coloured pill for a status. Pick the tone by meaning: `success` (Confirmed, Joined), " +
          "`info` (Hosting, Waitlist, Owner), `neutral` (Completed, Archived), `danger` (Removed, Forfeited).",
      },
    },
  },
  argTypes: {
    tone: { control: "select", options: TONES, description: "Colour by meaning (see above)." },
    children: { control: "text", description: "The status text." },
    className: { control: false },
  },
  args: { tone: "success", children: "Confirmed" },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Change the tone and text in Controls. */
export const Playground: Story = {};

/** All four tones with their typical labels. */
export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone="success">Confirmed</StatusBadge>
      <StatusBadge tone="info">Owner</StatusBadge>
      <StatusBadge tone="neutral">Archived</StatusBadge>
      <StatusBadge tone="danger">Forfeited</StatusBadge>
    </div>
  ),
  play: async ({ canvas }) => {
    for (const label of ["Confirmed", "Owner", "Archived", "Forfeited"]) {
      await expect(canvas.getByText(label)).toBeInTheDocument();
    }
  },
};