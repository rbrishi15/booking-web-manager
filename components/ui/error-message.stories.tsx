import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ErrorMessage } from "./error-message";

const meta = {
  title: "Design system/ErrorMessage",
  component: ErrorMessage,
  parameters: {
    docs: {
      description: {
        component:
          "A red box for a form or action error. It has `role=\"alert\"`, so screen readers announce it as soon " +
          "as it appears. Say what went wrong and what to do, e.g. \"Invalid email or password.\"",
      },
    },
  },
  argTypes: {
    children: { control: "text", description: "The message. Plain text, or text with a link." },
    className: { control: false },
  },
  args: { children: "Invalid email or password." },
} satisfies Meta<typeof ErrorMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit the message in Controls. */
export const Playground: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(String(args.children));
  },
};

export const LongMessage: Story = {
  args: {
    children:
      "You must complete your active sessions, use or withdraw your remaining funds, and archive any groups you own before deleting your account.",
  },
};