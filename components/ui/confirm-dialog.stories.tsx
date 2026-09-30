import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

/** Lets a story hold onConfirm "in progress" and finish it later. */
let finishConfirm: () => void = () => {};

const meta = {
  title: "Design system/ConfirmDialog",
  component: ConfirmDialog,
  parameters: {
    docs: {
      description: {
        component:
          "The last step before anything irreversible (withdraw, delete account, remove member). It shows the " +
          "amount involved (integer cents, e.g. `750` → S$7.50) before the user confirms. While `onConfirm` is " +
          "running, both buttons are disabled and the dialog can't be closed, so nothing is confirmed twice. If " +
          "`onConfirm` throws, the error message is shown inside the dialog and it stays open.",
      },
    },
  },
  argTypes: {
    trigger: { control: false, description: "The element that opens the dialog, usually a `<Button>`." },
    title: { control: "text", description: "The question, e.g. \"Withdraw from session?\"." },
    description: { control: "text", description: "What will happen, in plain words." },
    amountCents: {
      control: { type: "number", step: 50 },
      description: "Optional amount in integer SGD cents, shown large (e.g. 750 → S$7.50). Leave empty to hide.",
    },
    amountLabel: { control: "text", description: "Label above the amount.", table: { defaultValue: { summary: "Amount" } } },
    confirmLabel: { control: "text", description: "Text on the confirm button." },
    cancelLabel: { control: "text", description: "Text on the cancel button.", table: { defaultValue: { summary: "Cancel" } } },
    destructive: { control: "boolean", description: "Red confirm button for irreversible actions." },
    onConfirm: { control: false, description: "Runs on confirm. Throw an Error to show its message in the dialog." },
  },
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

/** Click the trigger to open it. Change the texts and amount in Controls. */
export const Playground: Story = {};

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

/** While confirming is in progress: buttons disabled, no second confirm, Escape can't close it. */
export const PendingBlocksDoubleConfirmAndClosing: Story = {
  args: {
    onConfirm: fn(
      () =>
        new Promise<void>((resolve) => {
          finishConfirm = resolve;
        }),
    ),
  },
  play: async ({ args, canvas, step }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");

    await step("Confirm: both buttons turn disabled while it runs", async () => {
      await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
      const working = await screen.findByRole("button", { name: "Working…" });
      await expect(working).toBeDisabled();
      await expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    await step("Clicking again and pressing Escape change nothing", async () => {
      await userEvent.click(screen.getByRole("button", { name: "Working…" }), { pointerEventsCheck: 0 });
      await userEvent.keyboard("{Escape}");
      // Wait longer than the close animation, then check the dialog is still open.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await expect(dialog).toHaveAttribute("data-state", "open");
      await expect(screen.getByRole("dialog")).toBeVisible();
      await expect(args.onConfirm).toHaveBeenCalledOnce();
    });

    await step("When it finishes, the dialog closes", async () => {
      finishConfirm();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await expect(args.onConfirm).toHaveBeenCalledOnce();
    });
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

/** Escape closes it without confirming, and keyboard focus goes back to the button that opened it. */
export const EscapeClosesAndRestoresFocus: Story = {
  play: async ({ args, canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Withdraw" });
    await userEvent.click(trigger);
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
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