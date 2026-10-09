import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import type { WalletSummary, WalletTransactionsPage, WalletTransport } from "../wallet-transport";
import { WalletView } from "./wallet-view";

const summary: WalletSummary = {
  availableBalanceCents: 2500,
  heldBalanceCents: 1875,
  activeHolds: [
    { holdId: "h1", sessionId: "s1", heldCents: 1250, originalCents: 1250, venueName: "Bishan Sports Hall", sport: "Badminton", startAt: "2045-04-02T10:00:00Z" },
    { holdId: "h2", sessionId: "s2", heldCents: 625, originalCents: 1250, venueName: "Jurong East Sports Hall", sport: "Tennis", startAt: "2045-04-05T02:00:00Z" },
  ],
};
const firstPage: WalletTransactionsPage = {
  items: [
    { transactionId: "t3", kind: "LOCK", amountCents: 1250, occurredAt: "2045-04-01T12:00:00Z" },
    { transactionId: "t2", kind: "REFUND", amountCents: 900, occurredAt: "2045-03-30T08:00:00Z" },
  ],
  nextCursor: "2045-03-30T08:00:00Z",
};
const secondPage: WalletTransactionsPage = {
  // The boundary row repeats, as a timestamp cursor can return it again.
  items: [
    { transactionId: "t2", kind: "REFUND", amountCents: 900, occurredAt: "2045-03-30T08:00:00Z" },
    { transactionId: "t1", kind: "TOP_UP", amountCents: 5000, occurredAt: "2045-03-29T08:00:00Z" },
  ],
  nextCursor: null,
};

function transport(overrides: Partial<WalletTransport> = {}): WalletTransport {
  return {
    loadSummary: fn<WalletTransport["loadSummary"]>(async () => ({ status: "ready", data: summary })),
    loadTransactions: fn<WalletTransport["loadTransactions"]>(async (before) => ({ status: "ready", data: before ? secondPage : firstPage })),
    ...overrides,
  };
}

const meta = {
  title: "Wallet/Overview",
  component: WalletView,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/wallet" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Joseph", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>],
  args: { transport: transport() },
} satisfies Meta<typeof WalletView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText("S$25.00")).toBeVisible());
    await expect(canvas.getByText("S$18.75")).toBeVisible();
    const holds = within(canvas.getByRole("region", { name: "Held for sessions" }));
    await expect(holds.getByText("Bishan Sports Hall")).toBeVisible();
    await expect(holds.getByText(/of/)).toHaveTextContent("of S$12.50");
    await expect(canvas.getByText("Held for a session")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** Load more appends the next page and never lists the repeated boundary transaction twice. */
export const LoadMore: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(canvas.getByText("Top-up")).toBeVisible());
    const list = within(canvas.getByRole("list", { name: "Transactions" }));
    await expect(list.getAllByRole("listitem")).toHaveLength(3);
    await expect(args.transport!.loadTransactions).toHaveBeenLastCalledWith("2045-03-30T08:00:00Z");
    await expect(canvas.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  },
};

export const NewWallet: Story = {
  args: { transport: transport({
    loadSummary: fn<WalletTransport["loadSummary"]>(async () => ({ status: "ready", data: { availableBalanceCents: 0, heldBalanceCents: 0, activeHolds: [] } })),
    loadTransactions: fn<WalletTransport["loadTransactions"]>(async () => ({ status: "ready", data: { items: [], nextCursor: null } })),
  }) },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText("Nothing held right now")).toBeVisible());
    await expect(canvas.getByText("No transactions yet")).toBeVisible();
    await expect(canvas.getAllByText("S$0.00")).toHaveLength(2);
  },
};

let unavailableAttempts = 0;
export const UnavailableThenRetry: Story = {
  beforeEach: () => { unavailableAttempts = 0; },
  args: { transport: transport({
    loadSummary: fn<WalletTransport["loadSummary"]>(async () => {
      unavailableAttempts += 1;
      return unavailableAttempts === 1
        ? { status: "error", code: "WALLET_API_UNAVAILABLE", message: "The wallet is temporarily unavailable. Please try again later." }
        : { status: "ready", data: summary };
    }),
  }) },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText(/temporarily unavailable/)).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(canvas.getByText("S$25.00")).toBeVisible());
  },
};

export const SignedOut: Story = {
  args: { transport: transport({
    loadSummary: fn<WalletTransport["loadSummary"]>(async () => ({ status: "error", code: "UNAUTHENTICATED", message: "Log in again to see your wallet." })),
    loadTransactions: fn<WalletTransport["loadTransactions"]>(async () => ({ status: "error", code: "UNAUTHENTICATED", message: "Log in again to see your wallet." })),
  }) },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login?next=%2Fwallet"));
  },
};

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText("S$25.00")).toBeVisible());
  },
};
