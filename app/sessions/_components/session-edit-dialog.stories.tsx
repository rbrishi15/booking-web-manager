import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { SessionEditDialog } from "./session-edit-dialog";
import { SessionEditingError, type SessionEditingTransport } from "../editing-transport";
import type { SessionEditingDetails } from "../editing-contract";

const editingFixture: SessionEditingDetails = {
  sessionId: "20000000-0000-4000-8000-000000000001", version: "a".repeat(64),
  booking: { venueName: "PCF Sparkletots Preschool @ Chua Chu Kang Blk 123 (KN)", region: "West", sport: "Tennis",
    startAt: "2045-11-06T01:50:00.000Z", endAt: "2045-11-06T03:20:00.000Z", totalCostCents: 3600, pricePerSlotCents: 600 },
  totalSlots: 6, visibility: "PUBLIC", canEdit: true, bookingLocked: false, minimumSlots: 1,
};

function Harness({ transport }: { transport: SessionEditingTransport }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return <><Button onClick={() => setOpen(true)}>Edit session</Button>
    {saved && <p role="status">Session updated.</p>}
    {open && <SessionEditDialog sessionId={editingFixture.sessionId} transport={transport}
      onClose={() => setOpen(false)} onSaved={() => { setSaved(true); setOpen(false); }} />}</>;
}
const transport = () => ({ load: fn(async () => editingFixture), save: fn(async () => editingFixture) });
function conflictTransport(): SessionEditingTransport {
  let calls = 0;
  return { load: fn(async () => ++calls === 1 ? editingFixture : { ...editingFixture, version: "b".repeat(64), bookingLocked: true, minimumSlots: 3, totalSlots: 7 }),
    save: fn(async () => { throw new SessionEditingError("STALE_SESSION", "This session has changed. Reload the latest details before saving.", true); }) };
}
function failingLoadTransport(): SessionEditingTransport {
  let calls = 0;
  return { ...transport(), load: fn(async () => { if (++calls === 1) throw new Error("Offline"); return editingFixture; }) };
}
const meta = { title: "Sessions/Edit session", component: Harness, args: { transport: transport() }, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;
async function open(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Edit session" }));
  const dialog = await within(document.body).findByRole("dialog", { name: "Edit session" });
  await within(dialog).findByLabelText("Venue name");
  return within(dialog);
}

export const Unjoined: Story = {
  args: { transport: transport() },
  play: async ({ canvasElement, args }) => {
    const dialog = await open(canvasElement);
    await expect(dialog.getByLabelText("Starts (SGT)")).toHaveValue("2045-11-06T09:50");
    await userEvent.clear(dialog.getByLabelText("Venue name"));
    await userEvent.type(dialog.getByLabelText("Venue name"), "New tennis court");
    await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));
    await expect(args.transport.save).toHaveBeenCalledWith(editingFixture.sessionId,
      expect.objectContaining({ version: editingFixture.version, booking: { ...editingFixture.booking, venueName: "New tennis court" } }));
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Session updated.");
  },
};
export const Joined: Story = {
  args: { transport: { ...transport(), load: fn(async () => ({ ...editingFixture, bookingLocked: true, minimumSlots: 3 })) } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement);
    await expect(dialog.getByLabelText("Venue name")).toBeDisabled();
    await expect(dialog.getByLabelText("Price per player (SGD)")).toBeDisabled();
    await expect(dialog.getByLabelText("Capacity")).toBeEnabled();
    await userEvent.clear(dialog.getByLabelText("Capacity"));
    await userEvent.type(dialog.getByLabelText("Capacity"), "8");
    await expect(dialog.getByLabelText("Visibility")).toBeEnabled();
  },
};
export const Cancel: Story = {
  args: { transport: transport() },
  play: async ({ canvasElement, args }) => {
    const dialog = await open(canvasElement);
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await expect(args.transport.save).not.toHaveBeenCalled();
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(within(canvasElement).getByRole("button", { name: "Edit session" })).toHaveFocus());
  },
};
export const SaveFailure: Story = {
  args: { transport: { ...transport(), save: fn(async () => { throw new SessionEditingError("INVALID_INPUT", "Price is outside the allowed range.", false); }) } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement);
    await userEvent.clear(dialog.getByLabelText("Venue name"));
    await userEvent.type(dialog.getByLabelText("Venue name"), "Keep my edit");
    await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));
    await expect(await dialog.findByRole("alert")).toHaveTextContent("Price is outside the allowed range.");
    await expect(dialog.getByLabelText("Venue name")).toHaveValue("Keep my edit");
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled();
  },
};
export const Conflict: Story = {
  args: { transport: conflictTransport() },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement);
    await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));
    await userEvent.click(await dialog.findByRole("button", { name: "Reload latest details" }));
    await waitFor(() => expect(dialog.getByLabelText("Capacity")).toHaveValue(7));
    await expect(dialog.getByLabelText("Venue name")).toBeDisabled();
  },
};
export const LoadFailure: Story = {
  args: { transport: failingLoadTransport() },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Edit session" }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.click(await dialog.findByRole("button", { name: "Retry" }));
    await expect(await dialog.findByLabelText("Venue name")).toHaveValue(editingFixture.booking.venueName);
  },
};
export const ReadOnly: Story = {
  args: { transport: { ...transport(), load: fn(async () => ({ ...editingFixture, canEdit: false })) } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement);
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await expect(dialog.getByLabelText("Capacity")).toBeDisabled();
  },
};
