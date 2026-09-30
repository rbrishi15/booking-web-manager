import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

/** The last step before anything irreversible: shows the amount, blocks double clicks, shows failures. */
const meta = {
  title: "Design system/ConfirmDialog",
  component: ConfirmDialog,
  argTypes: { trigger: { control: false }, onConfirm: { control: false } },
  args: {
    trigger: <Button variant="destructive">Withdraw</Button>,
    title: "Withdraw from session?",
    description: "You are withdrawing more than 30 hours before the start, so you get a full refund.",
    amountCents: 750,
    amountLabel: "Refund",
    confirmLabel: "Withdraw",
    destructive: true,
    onConfirm: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsAmountThenConfirms: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Withdraw" }));

    // The dialog opens in a portal, so look in the whole page, not just the story.
    const dialog = await screen.findByRole("dialog");
    await expect(dialog).toHaveTextContent("Refund");
    await expect(dialog).toHaveTextContent("S$7.50");

    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  },
};

export const CancelDoesNothing: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Withdraw" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const ShowsFailure: Story = {
  args: {
    onConfirm: fn(async () => {
      throw new Error("You must complete your active sessions before deleting your account.");
    }),
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    // The error is shown inside the dialog, which stays open so the user can read it.
    await expect(await screen.findByRole("alert")).toHaveTextContent("You must complete your active sessions");
    await expect(dialog).toBeInTheDocument();
  },
};

export const WithoutAmount: Story = {
  args: {
    trigger: <Button variant="outline">Archive group</Button>,
    title: "Archive this group?",
    description: "The invitation link is turned off and the group can no longer be changed.",
    amountCents: undefined,
    confirmLabel: "Archive group",
  },
};