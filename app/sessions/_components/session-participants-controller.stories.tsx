import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ParticipantManagementError, type participantManagementApi } from "../participant-management-transport";
import type { SessionInviteDisplay } from "../session-invitation-contract";
import { SessionParticipantsController } from "./session-participants-controller";

const sessionId = "20000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";
const aliceId = "30000000-0000-4000-8000-000000000001";
const session = { sessionId, venueName: "Bishan Sports Hall", sport: "Badminton", startAt: "2040-05-12T10:00:00Z", endAt: "2040-05-12T12:00:00Z", status: "OPEN" as const,
  availableSlots: 4, totalSlots: 5, booker: { displayName: "Host" }, canVerifyAttendance: false, participants: [] };

function Preview({ failOptions = false, switchSession = false, pendingOptions = false }: { readonly failOptions?: boolean; readonly switchSession?: boolean; readonly pendingOptions?: boolean }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [id, setId] = useState(sessionId);
  const roster = { ...session, participants: pendingOptions ? [{ participationId: aliceId, displayName: "Joined Alice", status: "COMMITTED" as const, attendance: "UNVERIFIED" as const, canRemove: true }] : [] };
  const [api] = useState<typeof participantManagementApi>(() => {
    let reads = 0;
    const invitations: SessionInviteDisplay[] = [];
    return {
      loadParticipantRoster: async (selectedId) => ({ ...roster, sessionId: selectedId }),
      loadParticipantInvitationOptions: async (selectedId) => {
        if (pendingOptions) return new Promise(() => undefined);
        if (failOptions && reads++ === 0) throw new ParticipantManagementError("INTERNAL_ERROR", 500, "Try again.");
        return { invitations: [...invitations], groups: [{ groupId: aliceId, name: selectedId === sessionId ? "Private first group" : "Second session group", memberCount: 1,
          members: [{ userId: aliceId, handle: "alice_01", displayName: "Alice Tan" }] }] };
      },
      findParticipantPlayer: async () => ({ status: "found", player: { handle: "alice_01", displayName: "Alice Tan", reliabilityScore: null, isSelf: false } }),
      sendParticipantInvitations: async () => {
        invitations.push({ inviteeId: aliceId, displayName: "Alice Tan", handle: "alice_01", status: "PENDING", invitedAt: "2039-01-01T00:00:00Z" });
        return { invited: 1, alreadyInvited: 0, alreadyParticipating: 0 };
      },
      loadParticipantRemovalPreview: async () => { throw new Error("No removal in this fixture"); },
      removeParticipantViaApi: async () => { throw new Error("No removal in this fixture"); },
    };
  });
  return <QueryClientProvider client={client}>
    {switchSession && <button onClick={() => setId("20000000-0000-4000-8000-000000000002")}>Switch session</button>}
    <SessionParticipantsController sessionId={id} userId={userId} outcome={{ status: "ready", session: { ...roster, sessionId: id } }} api={api} />
  </QueryClientProvider>;
}

const meta = { title: "Sessions/Participant API queries", component: Preview, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SendRefreshesInvitationHistory: Story = {
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole("button", { name: "Import from group" })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Invite player" }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("User ID", { exact: true }), "alice_01");
    await userEvent.click(dialog.getByRole("button", { name: "Add" }));
    await expect(await dialog.findByRole("button", { name: "Remove @alice_01" })).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Invite players" }));
    await expect(await canvas.findByRole("tab", { name: "Invitations (1)" })).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "Invitations (1)" }));
    await expect(canvas.getByRole("list", { name: "Invitations" })).toHaveTextContent("Alice Tan");
  },
};

export const FailedOptionsKeepRosterAndRetry: Story = {
  args: { failOptions: true },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Try again.");
    await expect(canvas.getByText("1 / 5 players")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Import from group" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Retry invitations" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Import from group" })).toBeEnabled());
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const PendingOptionsKeepRemovalAvailable: Story = {
  args: { pendingOptions: true },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Loading invitations and groups…")).toBeVisible();
    await waitFor(() => expect(canvas.getByRole("button", { name: "Manage Joined Alice" })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Manage Joined Alice" }));
    await expect(canvas.getByRole("button", { name: "Remove participant" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Import from group" })).toBeDisabled();
  },
};

export const SessionCachesAreIsolated: Story = {
  args: { switchSession: true },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole("button", { name: "Import from group" })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Import from group" }));
    const body = within(document.body);
    await waitFor(() => expect(body.getByText("Private first group")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole("button", { name: "Switch session" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Import from group" })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Import from group" }));
    await waitFor(() => expect(body.getByText("Second session group")).toBeVisible());
    await expect(body.queryByText("Private first group")).not.toBeInTheDocument();
  },
};
