import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useCallback, useMemo, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import type { VenueSearchPage } from "@/lib/venues/contracts";
import { CreateSessionWizard, type CreateSessionWizardProps } from "./create-session-wizard";
import { emptySessionDraft, pendingStorageKey, submissionPayload } from "./model";
import type { CreationOutcome } from "./transport";

const complete = { ...emptySessionDraft, venueName: "Bukit Timah CC", region: "Central", cost: "60.00", price: "7.50",
  startDate: "2045-06-17", startTime: "07:00", endDate: "2045-06-17", endTime: "08:00" };
const venues: VenueSearchPage = { items: [{ venueName: "Bukit Timah CC", address: "20 TOH YI DRIVE", postalCode: "596569", latitude: 1.34, longitude: 103.77, region: "Central" }], nextPage: null };
function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial !== undefined ? [[pendingStorageKey("storybook"), initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function Harness(props: CreateSessionWizardProps) {
  const storage = useMemo(() => memoryStorage(), []);
  return <CreateSessionWizard {...props} storage={props.storage ?? storage} />;
}
const meta = {
  title: "Sessions/Create session", component: CreateSessionWizard,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/sessions/create" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell mobileVariant="focused" user={{ name: "Neoh", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>],
  render: (args) => <Harness {...args} />,
  args: { userId: "storybook", create: fn<CreateSessionWizardProps["create"]>(async () => ({ status: "created" })), search: fn<CreateSessionWizardProps["search"]>(async () => venues), onCreated: fn() },
} satisfies Meta<typeof CreateSessionWizard>;
export default meta;
type Story = StoryObj<typeof CreateSessionWizard>;
const portal = () => within(document.body);

export const Details: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Next" }));
    await expect(canvas.getByText("Enter or select a venue.")).toBeVisible();
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Venue" })).toHaveFocus());
    await expect(canvas.getByRole("heading", { name: "Booked Venue Details" })).toBeVisible();
  },
};
export const DetailsAndNavigation: Story = {
  args: { initialDraft: complete },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Next" }));
    await expect(canvas.getByRole("heading", { name: "Booked Venue Settings" })).toHaveFocus();
    await userEvent.click(canvas.getByRole("button", { name: "Back" }));
    await expect(canvas.getByLabelText("Booking cost (SGD)")).toHaveValue("60.00");
    await expect(canvas.getByRole("combobox", { name: "Venue" })).toHaveValue("Bukit Timah CC");
  },
};
export const OvernightDates: Story = {
  args: { initialDraft: complete },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Edit booking dates and times" }));
    await userEvent.clear(portal().getByLabelText("Start time", { exact: true }));
    await userEvent.type(portal().getByLabelText("Start time", { exact: true }), "23:00");
    await userEvent.click(portal().getByRole("button", { name: "Save dates and times" }));
    await expect(portal().getByRole("alert")).toHaveTextContent("End must be after start");
    await userEvent.clear(portal().getByLabelText("End date", { exact: true }));
    await userEvent.type(portal().getByLabelText("End date", { exact: true }), "2045-06-18");
    await userEvent.click(portal().getByRole("button", { name: "Save dates and times" }));
    await expect(canvas.getByText(/Ends 18 Jun 2045/)).toBeVisible();
  },
};
export const Settings: Story = {
  args: { initialDraft: complete, initialStep: 2 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Increase No. of Slots" })).toBeDisabled();
    for (let index = 0; index < 6; index++) await userEvent.click(canvas.getByRole("button", { name: "Decrease No. of Slots" }));
    await expect(canvas.getByRole("button", { name: "Decrease No. of Slots" })).toBeDisabled();
    await expect(within(canvas.getByRole("group", { name: "No. of Slots" })).getByRole("status")).toHaveTextContent("2");
    await userEvent.click(canvas.getByRole("button", { name: "Increase No. of Slots" }));
    await userEvent.click(canvas.getByRole("combobox", { name: "Minimum Reliability Score" }));
    await userEvent.click(portal().getByRole("option", { name: "No minimum" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Next" }));
    await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toHaveValue("20.00");
  },
};
export const Pricing: Story = {
  args: { initialDraft: complete, initialStep: 3 },
  play: async ({ canvas }) => {
    const price = canvas.getByLabelText("Adjust price per slot (SGD)");
    await userEvent.clear(price); await userEvent.type(price, "12.01");
    await expect(canvas.getByRole("status")).toHaveTextContent("$96.08");
    await userEvent.click(canvas.getByRole("slider", { name: "Price per slot slider" }));
    // The focused slider supports exact one-cent keyboard adjustments.
    const before = Number((canvas.getByRole("slider") as HTMLInputElement).value);
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("slider")).toHaveValue(String(before + 1));
    await userEvent.clear(price); await userEvent.type(price, "15.01");
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(canvas.getByText("Choose a price within the displayed range.")).toBeVisible();
    await waitFor(() => expect(price).toHaveFocus());
  },
};
export const VenueLookup: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole("combobox", { name: "Venue" });
    await userEvent.type(input, "Bukit ");
    await waitFor(() => expect(canvas.getByRole("option", { name: /Bukit Timah CC/ })).toBeVisible());
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(input).toHaveValue("Bukit Timah CC");
    await expect(canvas.getByLabelText("Venue selected from OneMap")).toBeVisible();
    await expect(canvas.queryByRole("combobox", { name: "Region" })).not.toBeInTheDocument();
    await userEvent.type(input, " edited");
    await expect(canvas.queryByLabelText("Venue selected from OneMap")).not.toBeInTheDocument();
    await expect(canvas.getByRole("combobox", { name: "Region" })).toHaveTextContent("Choose a region");
  },
};
export const ManualFallback: Story = {
  args: { search: fn(async () => { throw new Error("private provider detail"); }) },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: "Venue" }), "Booked Court");
    await waitFor(() => expect(canvas.getByText("Venue search is unavailable. Enter the venue and region manually.")).toBeVisible());
    await userEvent.click(canvas.getByRole("combobox", { name: "Region" }));
    await userEvent.click(portal().getByRole("option", { name: "West" }));
    await expect(await canvas.findByRole("combobox", { name: "Region" })).toHaveTextContent("West");
  },
};
export const NoResults: Story = { args: { search: fn(async () => ({ items: [], nextPage: null })) }, play: async ({ canvas }) => {
  await userEvent.type(canvas.getByRole("combobox", { name: "Venue" }), "Court");
  await waitFor(() => expect(canvas.getByText("No venues found. Enter the venue and region manually.")).toBeVisible());
} };
export const UnknownRegion: Story = { args: { search: fn(async () => ({ ...venues, items: [{ ...venues.items[0]!, region: null }] })) }, play: async ({ canvas }) => {
  await userEvent.type(canvas.getByRole("combobox", { name: "Venue" }), "Bukit");
  await waitFor(() => expect(canvas.getByRole("option", { name: /Bukit Timah CC/ })).toBeVisible());
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect(canvas.getByText("Venue found. Choose a region below to continue.")).toBeVisible();
  await expect(canvas.getByRole("combobox", { name: "Region" })).toBeVisible();
} };
export const VenuePagination: Story = {
  args: { search: fn<CreateSessionWizardProps["search"]>(async (_query, page) => page === 1 ? { ...venues, nextPage: 2 } : { items: [{ ...venues.items[0]!, venueName: "Second court" }], nextPage: null }) },
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: "Venue" }), "Court");
    await waitFor(() => expect(canvas.getByRole("option", { name: /Bukit Timah CC/ })).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "More venues" }));
    await waitFor(() => expect(canvas.getByRole("option", { name: /Second court/ })).toBeVisible());
    await expect(canvas.getAllByRole("option")).toHaveLength(2);
    await expect(args.search).toHaveBeenCalledWith("Court", 2, expect.any(AbortSignal));
  },
};
function SearchRace(props: CreateSessionWizardProps) {
  const [resolveOld, setResolveOld] = useState<(() => void) | null>(null);
  const search = useCallback<CreateSessionWizardProps["search"]>(async (query, page, signal) => {
    void props.search(query, page, signal);
    if (query === "Old court") return new Promise((resolve) => setResolveOld(() => () => { resolve({ ...venues, items: [{ ...venues.items[0]!, venueName: "Stale court" }] }); setResolveOld(null); }));
    return { ...venues, items: [{ ...venues.items[0]!, venueName: "Current court" }] };
  }, [props.search]);
  return <><Harness {...props} search={search} />{resolveOld && <Button onClick={resolveOld}>Resolve stale search</Button>}</>;
}
export const StaleSearch: Story = {
  render: (args) => <SearchRace {...args} />,
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole("combobox", { name: "Venue" });
    await userEvent.type(input, "Old court");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Resolve stale search" })).toBeVisible());
    await userEvent.clear(input); await userEvent.type(input, "New court");
    await waitFor(() => expect(canvas.getByRole("option", { name: /Current court/ })).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Resolve stale search" }));
    await userEvent.click(input);
    await expect(canvas.queryByRole("option", { name: /Stale court/ })).not.toBeInTheDocument();
    await expect(canvas.getByRole("option", { name: /Current court/ })).toBeVisible();
    const first = (args.search as ReturnType<typeof fn<CreateSessionWizardProps["search"]>>).mock.calls[0];
    await expect(first?.[2].aborted).toBe(true);
  },
};
export const PayoutRequired: Story = {
  args: { initialDraft: complete, initialStep: 3, create: fn(async (): Promise<CreationOutcome> => ({ status: "error", code: "PAYOUT_ACCOUNT_NOT_READY", ambiguous: false, message: "Complete your payout account setup before creating a session." })) },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Complete your payout account setup");
    await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toBeEnabled();
  },
};
export const SignInExpired: Story = { ...PayoutRequired, args: { ...PayoutRequired.args, create: fn(async (): Promise<CreationOutcome> => ({ status: "error", code: "UNAUTHENTICATED", ambiguous: false, message: "Your sign-in has expired. Sign in again to continue." })) }, play: async ({ canvas }) => {
  await userEvent.click(canvas.getByRole("button", { name: "Done" })); await expect(canvas.getByRole("link", { name: "Sign in again" })).toBeVisible();
} };
export const ServiceUnavailable: Story = { ...PayoutRequired, args: { ...PayoutRequired.args, create: fn(async (): Promise<CreationOutcome> => ({ status: "error", code: "SESSION_API_UNAVAILABLE", ambiguous: false, message: "Session creation is temporarily unavailable. Please try again." })) }, play: async ({ canvas }) => {
  await userEvent.click(canvas.getByRole("button", { name: "Done" }));
  await expect(canvas.getByRole("alert")).toHaveTextContent("Session creation is temporarily unavailable");
  await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toBeEnabled();
} };
export const ServerValidation: Story = { ...PayoutRequired, args: { ...PayoutRequired.args, create: fn(async (): Promise<CreationOutcome> => ({ status: "error", code: "INVALID_INPUT", ambiguous: false, message: "Check your booking details and price, then try again." })) }, play: async ({ canvas }) => {
  await userEvent.click(canvas.getByRole("button", { name: "Done" }));
  await expect(canvas.getByRole("alert")).toHaveTextContent("Check your booking details and price");
  await expect(canvas.getByRole("button", { name: "Back" })).toBeEnabled();
} };
export const AmbiguousReplay: Story = {
  args: { initialDraft: complete, initialStep: 3, create: fn(async (): Promise<CreationOutcome> => ({ status: "created" })) },
  play: async ({ canvas, args }) => {
    const create = args.create as ReturnType<typeof fn<CreateSessionWizardProps["create"]>>;
    create.mockResolvedValueOnce({ status: "error", code: "UNKNOWN_RESULT", ambiguous: true, message: "Retry this submission to check safely." });
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(canvas.getByRole("button", { name: "Back" })).toBeDisabled();
    await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Retry submission" }));
    await expect(args.create).toHaveBeenCalledTimes(2);
    const calls = create.mock.calls;
    await expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
    await waitFor(() => expect(args.onCreated).toHaveBeenCalledOnce());
  },
};
export const PendingReload: Story = {
  args: { storage: memoryStorage(JSON.stringify({ version: 1, payload: submissionPayload(complete, "retained-key") })) },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("heading", { name: "Auto-Generated Pricing" })).toBeVisible();
    await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Retry submission" }));
    await expect(args.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "retained-key" }));
    await expect(args.storage?.getItem(pendingStorageKey("storybook"))).toBeNull();
  },
};
export const ReplaySignInExpired: Story = {
  args: { ...SignInExpired.args, storage: memoryStorage(JSON.stringify({ version: 1, payload: submissionPayload(complete, "unresolved-key") })) },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry submission" }));
    await expect(canvas.getByRole("link", { name: "Sign in again" })).toBeVisible();
    await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toBeDisabled();
    await expect(args.storage?.getItem(pendingStorageKey("storybook"))).toContain("unresolved-key");
  },
};
export const StorageUnavailable: Story = {
  args: { initialDraft: complete, initialStep: 3, storage: { getItem: fn((): string | null => { throw new Error("blocked"); }), setItem: fn(), removeItem: fn() } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("It may already have created a session");
    await expect(canvas.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(args.create).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "I checked my sessions; start again" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Enable session storage or free up storage space");
    await expect(canvas.getByRole("button", { name: "Done" })).toBeDisabled();
    (args.storage!.getItem as ReturnType<typeof fn<Storage["getItem"]>>).mockReturnValue(null);
    await userEvent.click(canvas.getByRole("button", { name: "I checked my sessions; start again" }));
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(args.onCreated).toHaveBeenCalledOnce();
  },
};
function unreadableStorage(value: string) {
  const storage = memoryStorage(value);
  return { ...storage, setItem: fn(storage.setItem), removeItem: fn(storage.removeItem) };
}
export const MalformedPendingSubmission: Story = {
  args: { initialDraft: complete, initialStep: 3, storage: unreadableStorage("{broken") },
  play: async ({ canvas, args }) => {
    const storage = args.storage!;
    const key = pendingStorageKey("storybook");
    const original = storage.getItem(key);
    await expect(canvas.getByRole("alert")).toHaveTextContent("It may already have created a session");
    await expect(canvas.getByRole("link", { name: "Check hosted sessions (new tab)" })).toHaveAttribute("href", "/sessions");
    await expect(canvas.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toBeDisabled();
    await expect(storage.removeItem).not.toHaveBeenCalled();
    await expect(storage.setItem).not.toHaveBeenCalled();
    await expect(args.create).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "I checked my sessions; start again" }));
    const backupKey = (storage.setItem as ReturnType<typeof fn<Storage["setItem"]>>).mock.calls[0]![0];
    await expect(backupKey).toMatch(`${key}:unresolved:`);
    await expect(storage.getItem(backupKey)).toBe(original);
    await expect(storage.getItem(key)).toBeNull();
    await expect(canvas.getByLabelText("Adjust price per slot (SGD)")).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(args.onCreated).toHaveBeenCalledOnce();
    await expect(storage.getItem(backupKey)).toBe(original);
  },
};
export const InvalidPendingSubmission: Story = {
  ...MalformedPendingSubmission,
  args: { ...MalformedPendingSubmission.args, storage: unreadableStorage('{"version":2,"payload":{}}') },
};
export const EmptyPendingSubmission: Story = {
  ...MalformedPendingSubmission,
  args: { ...MalformedPendingSubmission.args, storage: unreadableStorage("") },
};
export const RecoveryBackupUnavailable: Story = {
  args: { ...MalformedPendingSubmission.args, storage: unreadableStorage("{broken") },
  play: async ({ canvas, args }) => {
    const storage = args.storage!;
    (storage.setItem as ReturnType<typeof fn<Storage["setItem"]>>).mockImplementationOnce(() => { throw new Error("quota exceeded"); });
    await userEvent.click(canvas.getByRole("button", { name: "I checked my sessions; start again" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("We couldn't preserve your pending submission");
    await expect(storage.getItem(pendingStorageKey("storybook"))).toBe("{broken");
    await expect(storage.removeItem).not.toHaveBeenCalled();
    await expect(canvas.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(args.create).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "I checked my sessions; start again" }));
    await userEvent.click(canvas.getByRole("button", { name: "Done" }));
    await expect(args.onCreated).toHaveBeenCalledOnce();
  },
};
function DeferredSubmission(props: CreateSessionWizardProps) {
  const [finish, setFinish] = useState<(() => void) | null>(null);
  const create = (payload: Parameters<CreateSessionWizardProps["create"]>[0]) => {
    void props.create(payload);
    return new Promise<CreationOutcome>((resolve) => setFinish(() => () => { resolve({ status: "created" }); setFinish(null); }));
  };
  return <><Harness {...props} create={create} />{finish && <Button onClick={finish}>Finish test request</Button>}</>;
}
export const DuplicateSubmission: Story = {
  args: { initialDraft: complete, initialStep: 3 }, render: (args) => <DeferredSubmission {...args} />,
  play: async ({ canvas, args }) => {
    await userEvent.dblClick(canvas.getByRole("button", { name: "Done" }));
    await expect(canvas.getByRole("button", { name: "Creating…" })).toBeDisabled();
    await expect(args.create).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole("button", { name: "Finish test request" }));
    await expect(args.onCreated).toHaveBeenCalledOnce();
  },
};
export const Tablet: Story = { args: { initialDraft: complete, initialStep: 2 }, globals: { viewport: { value: "tablet", isRotated: false } } };
export const Desktop: Story = { args: { initialDraft: complete, initialStep: 3 }, globals: { viewport: { value: "desktop", isRotated: false } } };
export const Dark: Story = { args: { initialDraft: complete, initialStep: 3 }, globals: { theme: "dark" } };
