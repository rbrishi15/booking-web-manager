import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Button } from "./button";
import { EmptyState } from "./empty-state";

const meta = {
  title: "Design system/EmptyState",
  component: EmptyState,
  parameters: {
    docs: {
      description: {
        component:
          "Shown when a list has nothing in it yet (no groups, no sessions). Give a short title, one sentence on " +
          "what to do next, and optionally a button that does it.",
      },
    },
  },
  argTypes: {
    title: { control: "text", description: "Short headline, e.g. \"No groups yet\"." },
    description: { control: "text", description: "Optional sentence explaining what to do next." },
    action: { control: false, description: "Optional element under the text, usually a `<Button>`." },
    className: { control: false },
  },
  args: {
    title: "No groups yet",
    description: "Create a group for the people you play with, then share its invitation link.",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit the title and description in Controls; try a very long description. */
export const Playground: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText(args.title)).toBeInTheDocument();
  },
};

export const WithAction: Story = {
  args: { action: <Button>Create group</Button> },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Create group" })).toBeInTheDocument();
  },
};

export const TitleOnly: Story = { args: { description: undefined, title: "No sessions this week" } };