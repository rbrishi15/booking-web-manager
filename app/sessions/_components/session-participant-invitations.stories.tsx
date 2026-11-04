import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  SessionGroupImportDialog,
  SessionInviteDialog,
  type ImportGroup,
  type SessionInvitationsTransport,
} from "./session-participants-invitations";

const sessionId = "20000000-0000-4000-8000-000000000001";

const groups: readonly ImportGroup[] = [
  {
    groupId: "10000000-0000-4000-8000-000000000001",
    name: "Badminton Friends",
    memberCount: 4,
    members: [
      { userId: "30000000-0000-4000-8000-000000000001", displayName: "Alex Tan", handle: "alex_tan" },
      { userId: "30000000-0000-4000-8000-000000000002", displayName: "Priya Lim", handle: "priya_lim" },
      { userId: "30000000-0000-4000-8000-000000000003", displayName: "Sam Lee", handle: "sam_lee" },
    ],
  },
  {
    groupId: "10000000-0000-4000-8000-000000000002",
    name: "Weekend Basketball",
    memberCount: 3,
    members: [
      { userId: "30000000-0000-4000-8000-000000000004", displayName: "Taylor Chan", handle: "taylor_chan" },
      { userId: "30000000-0000-4000-8000-000000000005", displayName: "Jordan Ng", handle: "jordan_ng" },
    ],
  },
];

/** UI-only fakes: opening Storybook must never import or invoke server-only actions. */
const transport: SessionInvitationsTransport = {
  findPlayer: fn<SessionInvitationsTransport["findPlayer"]>(async (_previous, form) => {
    const handle = String(form.get("handle"));
    return { status: "found", player: { handle, displayName: "Storybook Player", reliabilityScore: null, isSelf: false } };
  }),
  loadSessionInvitation: fn<SessionInvitationsTransport["loadSessionInvitation"]>(async (id) => ({
    status: "ready", invitationPath: `/sessions/${id}/join?token=storybook-only`,
  })),
  sendDirectSessionInvitations: fn<SessionInvitationsTransport["sendDirectSessionInvitations"]>(async (_id, handles) => ({
    status: "sent", invited: handles.length, alreadyInvited: 0, alreadyParticipating: 0,
  })),
  sendGroupSessionInvitations: fn<SessionInvitationsTransport["sendGroupSessionInvitations"]>(async (_id, _groupId, userIds) => ({
    status: "sent", invited: userIds.length, alreadyInvited: 0, alreadyParticipating: 0,
  })),
};

const pendingTransport: SessionInvitationsTransport = { ...transport, findPlayer: () => new Promise(() => undefined) };
const delayedTransport: SessionInvitationsTransport = { ...transport,
  sendGroupSessionInvitations: async (_session, _group, users) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { status: "sent", invited: users.length, alreadyInvited: 0, alreadyParticipating: 0 };
  },
};

function InvitationPreview({ kind, lookupPending = false, delayedGroupSend = false }: { readonly kind: "direct" | "group"; readonly lookupPending?: boolean; readonly delayedGroupSend?: boolean }) {
  const [open, setOpen] = useState(true);
  const [notice, setNotice] = useState("");
  const onInvited = (result: { invited: number }) => setNotice(`${result.invited} invitations sent (simulated).`);

  return <main className="min-h-screen bg-background p-8 text-foreground">
    <button type="button" onClick={() => setOpen(true)}>
      {kind === "group" ? "Open import from group" : "Open invite players"}
    </button>
    {notice && <p role="status">{notice}</p>}
    {open && (kind === "group" ?
      <SessionGroupImportDialog sessionId={sessionId} transport={delayedGroupSend ? delayedTransport : transport} groups={groups} open
        onOpenChange={setOpen} onInvited={onInvited} /> :
      <SessionInviteDialog sessionId={sessionId} transport={lookupPending ? pendingTransport : transport} open
        onOpenChange={setOpen} onInvited={onInvited} />)}
  </main>;
}

const meta = {
  title: "Sessions/Player invitations",
  component: InvitationPreview,
  parameters: { layout: "fullscreen" },
  args: { kind: "direct" },
} satisfies Meta<typeof InvitationPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Search an exact user ID, add the result, and send via the mocked transport. */
export const InviteByUserId: Story = {};

export const PendingLookup: Story = {
  args: { lookupPending: true },
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog"));
    const input = dialog.getByLabelText("User ID", { exact: true });
    await userEvent.type(input, "alice_01");
    await userEvent.click(dialog.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Finding…" })).toBeDisabled());
    await expect(input).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Invite players" })).toBeDisabled();
  },
};

export const KeyboardInviteTabs: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole("dialog"));
    dialog.getByRole("tab", { name: "By user ID" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(dialog.getByRole("tab", { name: "By invite link" })).toHaveFocus();
    await expect(dialog.getByRole("tab", { name: "By invite link" })).toHaveAttribute("aria-selected", "true");
  },
};

/** The second tab of the same modal, with a generated test-only invitation link. */
export const InviteByLink: Story = {
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("tab", { name: "By invite link" }));
  },
};

/** Switch between groups and select recipients independently. */
export const ImportFromGroup: Story = { args: { kind: "group" } };

export const GroupSendAfterClose: Story = {
  args: { kind: "group", delayedGroupSend: true },
  play: async ({ canvas }) => {
    const body = within(document.body);
    const dialog = within(await body.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Invite 3 members" }));
    await userEvent.click(dialog.getByRole("button", { name: /^Close$/ }));
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole("button", { name: "Open import from group" }));
    await waitFor(() => expect(canvas.getByText("3 invitations sent (simulated).")).toBeInTheDocument());
    await expect(body.getByRole("dialog")).toBeVisible();
  },
};

export const ImportFromGroupMobile: Story = {
  args: { kind: "group" },
  globals: { viewport: { value: "phone", isRotated: false } },
};
