import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { Button } from "./button";

const meta = {
  title: "Design system/Button",
  component: Button,
  args: { children: "Join session", onClick: fn() },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "info", "destructive", "outline", "secondary", "ghost", "link"],
    },
    size: { control: "select", options: ["default", "sm", "lg", "icon"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "Join session" });
    // Buttons default to type="button" so they never submit a form by accident.
    await expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Info: Story = { args: { variant: "info", children: "Top up wallet" } };

export const Destructive: Story = { args: { variant: "destructive", children: "Delete account" } };

export const Outline: Story = { args: { variant: "outline", children: "View details" } };

export const Secondary: Story = { args: { variant: "secondary", children: "Back" } };

export const Ghost: Story = { args: { variant: "ghost", children: "Remove" } };

export const Link: Story = { args: { variant: "link", children: "Forgot password?" } };

export const Small: Story = { args: { size: "sm", children: "Save" } };

export const Disabled: Story = {
  args: { disabled: true, children: "Saving…" },
  play: async ({ args, canvas }) => {
    const button = canvas.getByRole("button", { name: "Saving…" });
    await expect(button).toBeDisabled();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const SubmitInsideForm: Story = {
  args: { type: "submit", children: "Create account" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Create account" })).toHaveAttribute("type", "submit");
  },
};