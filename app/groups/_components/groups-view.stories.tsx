import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { GroupsView, type GroupSummary } from "./groups-view";

const groups: GroupSummary[] = [
  { groupId: "weekend", name: "Weekend Tennis Club", memberCount: 8, memberNames: ["Marcus Lim", "Sarah Tan", "Alex Lee", "Priya Shah"], joinedAt: "2026-10-01T08:00:00Z", isOwner: true, archived: false, invitationActive: true },
  { groupId: "north", name: "North Spine Players", memberCount: 15, memberNames: ["Aisha Rahman", "Daniel Ng", "Sam Wong", "Jo Tan"], joinedAt: "2026-10-20T08:00:00Z", isOwner: false, archived: false, invitationActive: false },
  { groupId: "hall", name: "Hall 16 Tennis", memberCount: 6, memberNames: ["Jamie Chen", "Chris Tan", "Noor Aziz", "Ben Lim"], joinedAt: "2026-09-12T08:00:00Z", isOwner: false, archived: false, invitationActive: true },
  { groupId: "fusion", name: "Fusion Sports Crew", memberCount: 10, memberNames: ["Alex Lee", "Priya Shah", "Daniel Ng", "Jo Tan"], joinedAt: "2026-08-01T08:00:00Z", isOwner: false, archived: false, invitationActive: true },
  { groupId: "friends", name: "Tennis & Friends", memberCount: 4, memberNames: ["Marcus Lim", "Sam Wong", "Noor Aziz", "Ben Lim"], joinedAt: "2026-07-02T08:00:00Z", isOwner: false, archived: true, invitationActive: false },
];

const meta = {
  title: "Groups/Your groups",
  component: GroupsView,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/groups" } } },
  globals: { viewport: { value: "desktop", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Tian Pok Neoh", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>],
  args: {
    groups,
    left: false,
    createForm: <form onSubmit={(event) => event.preventDefault()}><label htmlFor="story-group-name">New group name</label><input className="my-2 block w-full rounded-md border bg-background p-3" id="story-group-name" name="name" /><button type="submit">Create group</button></form>,
  },
} satisfies Meta<typeof GroupsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Your groups" })).toBeVisible();
    await expect(canvas.getByRole("list", { name: "Your groups" }).children).toHaveLength(5);
    await expect(canvas.getByRole("link", { name: /Tennis & Friends/ })).toHaveAttribute("href", "/groups/friends");
    await expect(canvas.getByText("Archived", { exact: true })).toBeVisible();
  },
};

export const CreateDialog: Story = {
  play: async ({ canvas, userEvent, canvasElement }) => {
    const trigger = canvas.getByRole("button", { name: "Create group" });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const dialog = body.getByRole("dialog", { name: "Create a group" });
    await expect(within(dialog).getByRole("textbox", { name: "New group name" })).toHaveFocus();
    await userEvent.type(within(dialog).getByRole("textbox"), "Sunday players");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const Empty: Story = {
  args: { groups: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Your next game starts here" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Create group" })).toBeEnabled();

  },
};
export const LeftGroup: Story = {
  args: { left: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("You left the group.");
  },
};
export const SoloOwner: Story = {
  args: { groups: [{ groupId: "solo", name: "Sunday players", memberCount: 1, memberNames: ["Tian Pok Neoh"], joinedAt: "2026-10-26T08:00:00Z", isOwner: true, archived: false, invitationActive: true }] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("1 member", { exact: true })).toBeVisible();
    await expect(canvas.getByText("Owner", { exact: true })).toBeVisible();
  },
};
export const Dark: Story = { globals: { theme: "dark" } };
export const Mobile: Story = { globals: { viewport: { value: "phone", isRotated: false } } };
export const MobileDark: Story = { globals: { theme: "dark", viewport: { value: "phone", isRotated: false } } };
export const LongNames: Story = {
  args: { groups: [{ groupId: "long", name: "The very long weekend tennis and badminton neighbourhood club", memberCount: 8, joinedAt: "2026-10-01T08:00:00Z", isOwner: true, archived: false, invitationActive: true, memberNames: ["A very long player name", "Deleted user", "Unnamed player", "Sarah Tan"] }] },
  globals: { viewport: { value: "phone", isRotated: false } },
};
