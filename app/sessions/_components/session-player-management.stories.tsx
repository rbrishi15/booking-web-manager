import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import type { SessionParticipants } from "../removal-types";
import type { ImportGroup } from "../session-invitation-contract";
import { SessionParticipantsView } from "./session-participants-view";
import type { SessionInvitationsTransport } from "./session-participants-invitations";
import type { ParticipantRemovalTransport } from "./participant-removal-dialog";

const session: SessionParticipants = {
  sessionId: "20000000-0000-4000-8000-000000000001", sport: "Tennis",
  venueName: "PCF Sparkletots Preschool @ Chua Chu Kang Blk 123 (KN)",
  startAt: "2045-11-06T01:50:00Z", endAt: "2045-11-06T03:20:00Z",
  status: "OPEN", totalSlots: 6, availableSlots: 2, canVerifyAttendance: false,
  booker: { displayName: "Tian Pok Neoh" },
  participants: [
    { participationId: "asd", displayName: "asd", status: "COMMITTED", attendance: "UNVERIFIED", canRemove: true },
    { participationId: "test1", displayName: "testingaccount1", status: "COMMITTED", attendance: "UNVERIFIED", canRemove: true },
    { participationId: "test3", displayName: "testingaccount3", status: "COMMITTED", attendance: "UNVERIFIED", canRemove: true },
    { participationId: "left", displayName: "Previous player", status: "WITHDRAWN", attendance: "UNVERIFIED", canRemove: false },
  ],
};

const groups: readonly ImportGroup[] = [
  { groupId: "tennis", name: "Tennis Buddies", memberCount: 12, members: [
    { userId: "asd", displayName: "asd", handle: "asd" },
    { userId: "test1", displayName: "testingaccount1", handle: "testingaccount1" },
    { userId: "test3", displayName: "testingaccount3", handle: "testingaccount3" },
    { userId: "test4", displayName: "testingaccount4", handle: "testingaccount4" },
  ] },
  { groupId: "badminton", name: "Badminton Club", memberCount: 8, members: [{ userId: "test", displayName: "testaccount", handle: "testaccount" }] },
  { groupId: "hoops", name: "Hoops", memberCount: 6, members: [] },
];

const transport: SessionInvitationsTransport = {
  findPlayer: fn<SessionInvitationsTransport["findPlayer"]>(async (_previous, form) => {
    const handle = String(form.get("handle")).toLowerCase().replace(/^@/, "");
    return { status: "found", player: { handle, displayName: handle, reliabilityScore: null, isSelf: false } };
  }),
  loadSessionInvitation: fn<SessionInvitationsTransport["loadSessionInvitation"]>(async (id) => ({ status: "ready", invitationPath: `/sessions/${id}/join?token=storybook-only` })),
  sendDirectSessionInvitations: fn<SessionInvitationsTransport["sendDirectSessionInvitations"]>(async (_id, handles) => ({ status: "sent", invited: handles.length, alreadyInvited: 0, alreadyParticipating: 0 })),
  sendGroupSessionInvitations: fn<SessionInvitationsTransport["sendGroupSessionInvitations"]>(async (_id, _group, users) => ({ status: "sent", invited: users.length, alreadyInvited: 0, alreadyParticipating: 0 })),
};

function ReferencePage({ invitationError, referenceDate = false }: { readonly invitationError?: string; readonly referenceDate?: boolean }) {
  const displayedSession = referenceDate ? { ...session, startAt: "2026-11-06T01:50:00Z", endAt: "2026-11-06T03:20:00Z" } : session;
  return <AppShell user={{ name: "Tian Pok Neoh", reliabilityScore: 100 }} logoutAction={fn(async () => undefined)}>
    <SessionParticipantsView sessionId={session.sessionId} outcome={{ status: "ready", session: displayedSession }} groups={groups} invitations={[]}
      invitationTransport={transport} invitationError={invitationError} refreshing={false} onRefresh={fn()}
      removal={{ userId: "booker", preview: fn<ParticipantRemovalTransport["preview"]>(async () => ({ status: "error", code: "PREVIEW_UNAVAILABLE", message: "Preview unavailable in this visual fixture.", refresh: false, retrySameRequest: true })), remove: fn<ParticipantRemovalTransport["remove"]>(async () => ({ status: "error", code: "REMOVAL_UNAVAILABLE", message: "Removal unavailable in this visual fixture.", refresh: false, retrySameRequest: true })) }} />
  </AppShell>;
}

const meta = {
  title: "Sessions/Player management", component: ReferencePage,
  parameters: { layout: "fullscreen", themes: { themeOverride: "dark" }, nextjs: { navigation: { pathname: "/sessions/example/participants" } } },
  args: {}, globals: { theme: "dark" },
} satisfies Meta<typeof ReferencePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Dark: Story = { args: { referenceDate: true } };
export const Light: Story = { args: { referenceDate: true }, globals: { theme: "light" }, parameters: { themes: { themeOverride: "light" } } };
export const MacbookAirNarrow: Story = {
  args: { referenceDate: true },
  play: async ({ canvas }) => {
    const tabsList = canvas.getByRole("tablist", { name: "Participant status" });
    await expect(canvas.getByRole("tab", { name: "Invitations (0)" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Import from group$/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Invite player$/ })).toBeVisible();
    if (window.innerWidth >= 1200 && window.innerWidth <= 1440) {
      await waitFor(() => expect(tabsList.scrollWidth).toBeLessThanOrEqual(tabsList.clientWidth + 2));
    }
  },
};

export const InvitePlayers: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Invite player$/ }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    for (const handle of ["asd_01", "testaccount"]) {
      await userEvent.type(dialog.getByLabelText("User ID", { exact: true }), handle);
      await userEvent.click(dialog.getByRole("button", { name: /^Add$/ }));
      await waitFor(() => expect(dialog.getByText(`@${handle}`, { exact: true })).toBeVisible());
    }
  },
};

export const ImportFromGroup: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Import from group$/ }));
    await waitFor(() => expect(within(document.body).getByRole("dialog")).toBeVisible());
  },
};

export const InvitationsUnavailable: Story = {
  args: { invitationError: "Could not load invitations and groups. Try again." },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("list", { name: "Participants" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Retry invitations" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: /^Import from group$/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole("tab", { name: "Invitations (—)" }));
    await expect(canvas.queryByText("You haven’t invited any players yet.")).not.toBeInTheDocument();
  },
};

export const KeyboardTabs: Story = {
  play: async ({ canvas }) => {
    const participants = canvas.getByRole("tab", { name: "Participants (4)" });
    participants.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("tab", { name: "Waitlist (0)" })).toHaveFocus();
    await expect(canvas.getByRole("tab", { name: "Waitlist (0)" })).toHaveAttribute("aria-selected", "true");
  },
};

export const InvitationFocus: Story = {
  play: async ({ canvas }) => {
    const body = within(document.body);
    for (const name of ["Invite player", "Import from group"]) {
      const opener = canvas.getByRole("button", { name: new RegExp(`^${name}$`) });
      await userEvent.click(opener);
      await body.findByRole("dialog");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus());
      await userEvent.click(opener);
      const dialog = within(await body.findByRole("dialog"));
      await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(opener).toHaveFocus());
      await userEvent.click(opener);
      const sending = within(await body.findByRole("dialog"));
      if (name === "Invite player") {
        await userEvent.type(sending.getByLabelText("User ID", { exact: true }), "alice_01");
        await userEvent.click(sending.getByRole("button", { name: /^Add$/ }));
        await waitFor(() => expect(sending.getByText("@alice_01", { exact: true })).toBeVisible());
        await userEvent.click(sending.getByRole("button", { name: "Invite players" }));
      } else await userEvent.click(sending.getByRole("button", { name: "Invite 4 members" }));
      await waitFor(() => expect(opener).toHaveFocus());
    }
  },
};
