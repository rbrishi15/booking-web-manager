import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import type { TopUpTransport } from "../top-up-transport";
import { TopUpPanel } from "./top-up-panel";
import { firstTransactionsPage, walletSummary } from "./wallet-fixtures";
import { WalletView, type WalletViewProps } from "./wallet-view";

const meta = {
  title: "Wallet/Overview",
  component: WalletView,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/wallet" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Joseph", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>],
  // These view stories exercise controls explicitly; controller stories drive scroll events.
  beforeEach: () => {
    const original = window.IntersectionObserver;
    window.IntersectionObserver = class implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    };
    return () => { window.IntersectionObserver = original; };
  },
  args: {
    summary: { status: "ready", data: walletSummary },
    history: { status: "ready", data: firstTransactionsPage },
    loadingMore: false,
    moreError: null,
    onRetry: fn(),
    onLoadMore: fn(),
  },
} satisfies Meta<typeof WalletView>;

export default meta;
type Story = StoryObj<typeof meta>;

async function chooseDateRange(trigger: HTMLElement, option: string) {
  await userEvent.click(trigger);
  await userEvent.click(within(document.body).getByRole("option", { name: option }));
  await waitFor(() => expect(trigger).toHaveFocus());
}

export const Populated: Story = {
  play: async ({ args, canvas }) => {
    const balance = within(canvas.getByRole("region", { name: "Balance" }));
    await expect(balance.getByText("$25.00")).toBeVisible();
    await expect(balance.getByText("$18.75")).toBeVisible();
    await expect(balance.getByLabelText("Pending withdrawals unavailable")).toHaveTextContent("—");
    const holds = within(canvas.getByRole("region", { name: "Held for sessions" }));
    await expect(holds.getByText("Bishan Sports Hall")).toBeVisible();
    await expect(holds.getByText(/of/)).toHaveTextContent("of $12.50");
    await expect(within(canvas.getByRole("list", { name: "Transactions" })).getByText("Funds held")).toBeVisible();
    canvas.getByRole("button", { name: "Load more" }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onLoadMore).toHaveBeenCalledOnce();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const Loading: Story = {
  args: { summary: { status: "loading" }, history: { status: "loading" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Loading your balance…")).toBeVisible();
    await expect(canvas.getByText("Loading transactions…")).toBeVisible();
  },
};

export const NewWallet: Story = {
  args: {
    summary: { status: "ready", data: { availableBalanceCents: 0, heldBalanceCents: 0, pendingPayoutCents: 0, activeHolds: [] } },
    history: { status: "ready", data: { items: [], nextCursor: null } },
  },
  play: async ({ canvas }) => {
    await expect(within(canvas.getByRole("region", { name: "Held for sessions" })).getByText("Nothing held right now")).toBeVisible();
    await expect(canvas.getByText("No transactions yet")).toBeVisible();
    const balance = within(canvas.getByRole("region", { name: "Balance" }));
    await expect(balance.getAllByText("$0.00")).toHaveLength(3);
  },
};

export const LoadingMore: Story = {
  args: { loadingMore: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Loading more transactions…")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  },
};

export const LoadMoreFailed: Story = {
  args: { moreError: "We couldn't load your wallet. Check your connection and try again." },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/check your connection/i)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Load more" })).toBeEnabled();
  },
};

export const Unavailable: Story = {
  args: {
    summary: { status: "error", message: "The wallet is temporarily unavailable. Please try again later.", signIn: false },
    history: { status: "error", message: "The wallet is temporarily unavailable. Please try again later.", signIn: false },
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getAllByRole("button", { name: "Retry" })[0]!);
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const SignedOut: Story = {
  args: {
    summary: { status: "error", message: "Log in again to see your wallet.", signIn: true },
    history: { status: "error", message: "Log in again to see your wallet.", signIn: true },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login?next=%2Fwallet");
    await expect(canvas.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  },
};

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => {
    const balance = within(canvas.getByRole("region", { name: "Balance" }));
    await expect(balance.getByLabelText("S$25.00")).toBeVisible();
  },
};

export const DesktopSectionSwitching: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => {
    const history = within(canvas.getByRole("region", { name: "Transactions" }));
    await expect(history.getByRole("tab", { name: "All transactions" })).toHaveAttribute("aria-selected", "true");
    const table = history.getByRole("table", { name: "Transactions" });
    await userEvent.type(history.getByRole("textbox", { name: "Search transactions" }), "refund");
    await userEvent.click(history.getByText("Active holds", { exact: true }));
    await expect(history.getByRole("tab", { name: "Active holds" })).toHaveAttribute("aria-selected", "true");
    await expect(table).not.toBeVisible();
    await expect(history.getByRole("textbox", { name: "Search transactions", hidden: true })).not.toBeVisible();
    await expect(history.getByRole("link", { name: /Bishan Sports Hall/ })).toBeVisible();
    await expect(history.getByRole("link", { name: "Payouts" })).toHaveAttribute("href", "/payouts");
    await userEvent.keyboard("{ArrowLeft}");
    await expect(history.getByRole("tab", { name: "All transactions" })).toHaveAttribute("aria-selected", "true");
    await expect(table).toBeVisible();
    await expect(history.getByRole("textbox", { name: "Search transactions" })).toHaveValue("refund");
    await expect(within(table).getByText("Refund", { exact: true })).toBeVisible();
    await expect(within(table).queryByText("Hold", { exact: true })).not.toBeInTheDocument();
  },
};

export const DesktopSectionPagination: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { history: { status: "ready", data: {
    items: Array.from({ length: 10 }, (_, index) => ({
      ...firstTransactionsPage.items[0]!, transactionId: `section-page-${index}`,
    })),
    nextCursor: null,
  } } },
  play: async ({ canvas }) => {
    const history = within(canvas.getByRole("region", { name: "Transactions" }));
    await userEvent.click(history.getByRole("button", { name: "Page 2" }));
    await userEvent.click(history.getByRole("tab", { name: "Active holds" }));
    await userEvent.click(history.getByRole("tab", { name: "All transactions" }));
    await expect(history.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await expect(within(history.getByRole("table", { name: "Transactions" })).getAllByRole("row")).toHaveLength(3);
  },
};

const pagedHolds = Array.from({ length: 19 }, (_, index) => ({
  ...walletSummary.activeHolds[index % 2]!,
  holdId: `paged-hold-${index}`,
  sessionId: `paged-session-${index}`,
  venueName: `Court ${index + 1}`,
  startAt: new Date(Date.now() + (index < 10 ? 5 : 45) * 86_400_000).toISOString(),
}));

export const DesktopHoldsPagination: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "ready", data: { ...walletSummary, activeHolds: pagedHolds } } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    const table = within(panel.getByRole("table", { name: "Active holds" }));
    await expect(table.getByRole("columnheader", { name: "Booking" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Amount" })).toBeVisible();
    await expect(table.getAllByRole("row")).toHaveLength(9);
    await expect(panel.getByText("Showing 1–8 of 19 active holds")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Previous holds page" })).toBeDisabled();
    await userEvent.click(panel.getByRole("button", { name: "Holds page 3" }));
    await expect(table.getAllByRole("row")).toHaveLength(4);
    await expect(table.getByText("Court 17", { exact: true })).toBeVisible();
    await expect(panel.getByText("Showing 17–19 of 19 active holds")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Next holds page" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("tab", { name: "All transactions" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    await expect(panel.getByRole("button", { name: "Holds page 3" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(panel.getByRole("button", { name: "Previous holds page" }));
    await expect(panel.getByText("Showing 9–16 of 19 active holds")).toBeVisible();
  },
};

export const DesktopHoldsSearch: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "ready", data: { ...walletSummary, activeHolds: pagedHolds } } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    await userEvent.click(panel.getByRole("button", { name: "Holds page 3" }));
    const search = canvas.getByRole("textbox", { name: "Search active holds" });
    await userEvent.type(search, "Court 19");
    const table = within(panel.getByRole("table", { name: "Active holds" }));
    await expect(table.getAllByRole("row")).toHaveLength(2);
    await expect(table.getByText("Court 19", { exact: true })).toBeVisible();
    await expect(panel.getByText("Showing 1–1 of 1 active hold")).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "All transactions" }));
    await expect(canvas.getByRole("textbox", { name: "Search transactions" })).toHaveValue("");
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    await expect(search).toHaveValue("Court 19");
    await userEvent.clear(search);
    await userEvent.type(search, "no matching booking");
    await expect(panel.getByText("No matching holds")).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Clear hold filters" }));
    await expect(search).toHaveValue("");
    await expect(within(panel.getByRole("table", { name: "Active holds" })).getAllByRole("row")).toHaveLength(9);
    await expect(panel.getByText("Showing 1–8 of 19 active holds")).toBeVisible();
  },
};

export const DesktopHoldsDateFilter: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "ready", data: { ...walletSummary, activeHolds: pagedHolds } } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    await userEvent.click(panel.getByRole("button", { name: "Holds page 3" }));
    await chooseDateRange(canvas.getByRole("combobox", { name: "Session date range" }), "Next 30 days");
    await expect(await panel.findByText("Showing 1–8 of 10 active holds")).toBeVisible();
    await userEvent.click(await panel.findByRole("button", { name: "Next holds page" }));
    await expect(panel.getByText("Showing 9–10 of 10 active holds")).toBeVisible();
    await expect(within(panel.getByRole("table", { name: "Active holds" })).getAllByRole("row")).toHaveLength(3);
  },
};

function HoldsRefreshHarness(props: WalletViewProps) {
  const [summary, setSummary] = useState(props.summary);
  return <>
    <Button onClick={() => {
      if (summary.status === "ready") setSummary({ status: "ready", data: { ...summary.data, activeHolds: summary.data.activeHolds.slice(0, 2) } });
    }}>Simulate hold release</Button>
    <WalletView {...props} summary={summary} />
  </>;
}

export const DesktopHoldsRefresh: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "ready", data: { ...walletSummary, activeHolds: pagedHolds } } },
  render: (args) => <HoldsRefreshHarness {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    await userEvent.click(panel.getByRole("button", { name: "Holds page 3" }));
    await userEvent.click(canvas.getByRole("button", { name: "Simulate hold release" }));
    await expect(await panel.findByText("Showing 1–2 of 2 active holds")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Holds page 1" })).toHaveAttribute("aria-current", "page");
    await expect(within(panel.getByRole("table", { name: "Active holds" })).getAllByRole("row")).toHaveLength(3);
  },
};

export const DesktopHoldsWithoutSessionDetails: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "ready", data: { ...walletSummary, activeHolds: [{
    ...walletSummary.activeHolds[1]!, venueName: undefined, sport: undefined, startAt: undefined, isBooker: true,
  }] } } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    const table = within(panel.getByRole("table", { name: "Active holds" }));
    await expect(table.getByText("Session", { exact: true, selector: "p" })).toBeVisible();
    await expect(table.getByText("Partially held")).toBeVisible();
    await expect(table.getByRole("link", { name: "View session" })).toHaveAttribute("href", "/sessions/s2/participants");
    await chooseDateRange(canvas.getByRole("combobox", { name: "Session date range" }), "Next 30 days");
    await expect(await panel.findByText("No matching holds")).toBeVisible();
  },
};

export const DesktopEmptyHolds: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "ready", data: { ...walletSummary, heldBalanceCents: 0, activeHolds: [] } } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    await expect(panel.getByText("Nothing held right now")).toBeVisible();
    await expect(canvas.queryByRole("table", { name: "Transactions" })).not.toBeInTheDocument();
  },
};

export const DesktopHoldsLoading: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "loading" } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    await expect(within(canvas.getByRole("tabpanel", { name: "Active holds" })).getByText("Loading active holds…")).toBeVisible();
  },
};

export const DesktopHoldsUnavailable: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { summary: { status: "error", message: "The wallet is temporarily unavailable. Please try again later.", signIn: false } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    await expect(panel.getByText(/wallet is temporarily unavailable/i)).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Retry" }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole("tab", { name: "All transactions" }));
    await expect(canvas.getByRole("table", { name: "Transactions" })).toBeVisible();
  },
};

export const DesktopHoldsWithoutHistory: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { history: { status: "error", message: "Transaction history is temporarily unavailable.", signIn: false } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Active holds" }));
    const panel = within(canvas.getByRole("tabpanel", { name: "Active holds" }));
    await expect(panel.getByRole("link", { name: /Bishan Sports Hall/ })).toBeVisible();
    await expect(canvas.queryByText("Transaction history is temporarily unavailable.")).not.toBeVisible();
  },
};

export const HeldSessionDestination: Story = {
  args: { summary: { status: "ready", data: {
    ...walletSummary,
    activeHolds: [{ ...walletSummary.activeHolds[0]!, sessionId: "10000000-0000-4000-8000-000000000001" }],
  } } },
  play: async ({ canvas }) => {
    const holds = within(canvas.getByRole("region", { name: "Held for sessions" }));
    await expect(holds.getByRole("link", { name: /Bishan Sports Hall/ }))
      .toHaveAttribute("href", "/sessions?tab=joined&session=10000000-0000-4000-8000-000000000001");
  },
};

export const SelfBookedHoldDestination: Story = {
  args: { summary: { status: "ready", data: {
    ...walletSummary,
    activeHolds: [{ ...walletSummary.activeHolds[0]!, sessionId: "10000000-0000-4000-8000-000000000001", isBooker: true }],
  } } },
  play: async ({ canvas }) => {
    const holds = within(canvas.getByRole("region", { name: "Held for sessions" }));
    await expect(holds.getByRole("link", { name: /Bishan Sports Hall/ }))
      .toHaveAttribute("href", "/sessions/10000000-0000-4000-8000-000000000001/participants");
  },
};

export const SearchTransactions: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "See all" }));
    const history = within(canvas.getByRole("region", { name: "Transactions" }));
    const search = history.getByRole("textbox", { name: "Search transactions" });
    await userEvent.type(search, "refund");
    await expect(within(await history.findByRole("list", { name: "Transactions" })).getByText("Refund", { exact: true })).toBeVisible();
    await expect(history.queryByText("Funds held")).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "no matching activity");
    await expect(history.queryByRole("list", { name: "Transactions" })).not.toBeInTheDocument();
    history.getByRole("button", { name: "Load more" }).focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onLoadMore).toHaveBeenCalledOnce();

    await userEvent.clear(search);
    await expect(within(history.getByRole("list", { name: "Transactions" })).getAllByRole("listitem")).toHaveLength(2);
  },
};

export const FilterTransactions: Story = {
  args: {
    history: {
      status: "ready",
      data: {
        items: [
          { ...firstTransactionsPage.items[0]!, occurredAt: new Date(Date.now() - 60 * 86_400_000).toISOString() },
          { ...firstTransactionsPage.items[1]!, occurredAt: new Date(Date.now() - 5 * 86_400_000).toISOString() },
        ],
        nextCursor: null,
      },
    },
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "See all" }));
    const history = within(canvas.getByRole("region", { name: "Transactions" }));
    await chooseDateRange(history.getByRole("combobox", { name: "Date range" }), "Last 30 days");
    await expect(within(await history.findByRole("list", { name: "Transactions" })).getByText("Refund", { exact: true })).toBeVisible();
    await expect(history.queryByText("Funds held")).not.toBeInTheDocument();

    await chooseDateRange(await history.findByRole("combobox", { name: "Date range" }), "Last 90 days");
    await expect(within(await history.findByRole("list", { name: "Transactions" })).getAllByRole("listitem")).toHaveLength(2);
    await chooseDateRange(await history.findByRole("combobox", { name: "Date range" }), "All time");
    await expect(within(await history.findByRole("list", { name: "Transactions" })).getAllByRole("listitem")).toHaveLength(2);
  },
};

export const FundsActions: Story = {
  play: async ({ canvas }) => {
    const balance = within(canvas.getByRole("region", { name: "Balance" }));
    await expect(balance.getByRole("link", { name: "Withdraw" })).toHaveAttribute("href", "/payouts");
    await expect(canvas.getByText("Topping up with PayNow is coming soon.")).not.toBeVisible();
    await userEvent.click(balance.getByRole("button", { name: "Add funds" }));
    await expect(within(document.body).getByText("Topping up with PayNow is coming soon.")).toBeVisible();
    const holds = within(canvas.getByRole("region", { name: "Held for sessions" }));
    await expect(holds.getByRole("link", { name: /Bishan Sports Hall/ })).toHaveAttribute("href", "/sessions?tab=joined&session=s1");
    await expect(holds.getByRole("link", { name: /Jurong East Sports Hall/ })).toHaveAttribute("href", "/sessions?tab=joined&session=s2");
  },
};

const mockPayNowSession = {
  clientSecret: "pi_test_secret_mock",
  paymentIntentId: "pi_test_mock",
  amountCents: 1234,
  qrCode: {
    // Decorative, unscannable QR preview: actual payments use the URL from Stripe.
    imageUrlPng: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224" viewBox="0 0 224 224"><rect width="224" height="224" fill="white"/><g fill="black"><path d="M8 8h64v64H8zM16 16v48h48V16zM152 8h64v64h-64zM160 16v48h48V16zM8 152h64v64H8zM16 160v48h48v-48zM88 8h16v16H88zM120 24h16v32h-16zM88 72h48v16H88zM152 88h16v48h-16zM184 88h32v16h-32zM88 104h16v48H88zM120 120h16v16h-16zM104 168h64v16h-64zM184 152h16v64h-16zM120 200h48v16h-48z"/></g></svg>'),
    expiresAt: Date.now() + 3600000,
    testPaymentUrl: "https://payments.stripe.com/test/paynow/authorize",
  },
};

const previewTopUp = {
  startPayNow: fn<TopUpTransport["startPayNow"]>(async (cents) => ({
    status: "ready" as const, session: { ...mockPayNowSession, amountCents: cents },
  })),
  checkPayment: fn<TopUpTransport["checkPayment"]>(async () => ({ status: "paid" })),
};
const previewPaid = fn();

export const AvailableTopUp: Story = {
  args: { topUp: <TopUpPanel transport={previewTopUp} onPaid={previewPaid} /> },
  beforeEach: () => {
    previewTopUp.startPayNow.mockClear();
    previewTopUp.checkPayment.mockClear();
    previewPaid.mockClear();
  },
  play: async ({ canvas }) => {
    const balance = within(canvas.getByRole("region", { name: "Balance" }));
    await userEvent.click(balance.getByRole("button", { name: "Add funds" }));
    const modal = within(document.body).getByRole("dialog", { name: "Add funds to your wallet" });
    const topUp = within(modal);
    const amount = topUp.getByRole("textbox", { name: "Amount (S$)" });
    await userEvent.click(topUp.getByRole("button", { name: "S$20" }));
    await expect(amount).toHaveValue("20");
    await userEvent.clear(amount);
    await userEvent.type(amount, "12.34");
    await userEvent.click(topUp.getByRole("button", { name: "Continue with PayNow" }));
    await expect(previewTopUp.startPayNow).toHaveBeenCalledWith(1234, expect.any(String));
    await waitFor(() => expect(previewPaid).toHaveBeenCalledOnce());
    await expect(topUp.getByText("Payment confirmed!")).toBeVisible();
    await expect(topUp.getByText("PayNow (Test)")).toBeVisible();
    await expect(topUp.getByText("pi_test_mock")).toBeVisible();
    await expect(topUp.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(balance.getByText("$25.00")).toBeVisible();
  },
};

const waitingTopUp: TopUpTransport = {
  startPayNow: async (cents) => ({ status: "ready", session: { ...mockPayNowSession, amountCents: cents } }),
  checkPayment: async () => ({ status: "pending" }),
};

/** Stable review state for automated desktop screenshots of stage one. */
export const TopUpAmountPreview: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { topUp: <TopUpPanel transport={waitingTopUp} onPaid={fn()} /> },
  play: async ({ canvas }) => {
    await userEvent.click(within(canvas.getByRole("region", { name: "Balance" })).getByRole("button", { name: "Add funds" }));
    const modal = within(document.body).getByRole("dialog", { name: "Add funds to your wallet" });
    await expect(within(modal).getByRole("textbox", { name: "Amount (S$)" })).toBeVisible();
  },
};

export const PayNowAmountPreview: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { topUp: <TopUpPanel transport={waitingTopUp} onPaid={fn()} /> },
  play: async ({ canvas }) => {
    await userEvent.click(within(canvas.getByRole("region", { name: "Balance" })).getByRole("button", { name: "Add funds" }));
    await expect(within(document.body).getByRole("dialog", { name: "Add funds to your wallet" })).toBeVisible();
  },
};

/** Capture-only fixture. No Storybook play() so Chromium controls both steps deterministically. */
export const PayNowScreenshotCapture: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { topUp: <TopUpPanel transport={waitingTopUp} onPaid={fn()} /> },
};

export const PayNowQrPreview: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { topUp: <TopUpPanel transport={waitingTopUp} onPaid={fn()} /> },
  play: async ({ canvas }) => {
    await userEvent.click(within(canvas.getByRole("region", { name: "Balance" })).getByRole("button", { name: "Add funds" }));
    const modal = within(within(document.body).getByRole("dialog"));
    await userEvent.click(modal.getByRole("button", { name: "Continue with PayNow" }));
    await expect(await modal.findByRole("img", { name: /PayNow QR code/ })).toBeVisible();
    await expect(modal.getByText("Waiting for payment confirmation")).toBeVisible();
    await expect(modal.getByRole("link", { name: /Simulate scan/ })).toHaveAttribute("href", "https://payments.stripe.com/test/paynow/authorize");
    await expect(modal.getByRole("link", { name: /Simulate scan/ })).toHaveAttribute("target", "_blank");
  },
};


/** Narrow desktop: a dialog must never overflow the viewport horizontally. */
export const PayNowNarrowDesktop: Story = {
  parameters: {
    viewport: {
      options: {
        narrowWallet: { name: "Narrow desktop 560 × 700", styles: { width: "560px", height: "700px" }, type: "desktop" },
      },
    },
  },
  globals: { viewport: { value: "narrowWallet", isRotated: false } },
  args: { topUp: <TopUpPanel transport={waitingTopUp} onPaid={fn()} /> },
  play: async ({ canvas }) => {
    await userEvent.click(within(canvas.getByRole("region", { name: "Balance" })).getByRole("button", { name: "Add funds" }));
    const modal = within(document.body).getByRole("dialog", { name: "Add funds to your wallet" });
    await expect(within(modal).getByRole("heading", { name: "Add funds." })).toBeVisible();
    await expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth + 2);
    await userEvent.click(within(modal).getByRole("button", { name: "Continue with PayNow" }));
    await expect(await within(modal).findByRole("link", { name: /Simulate scan/ })).toBeVisible();
    await expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth + 2);
  },
};

/** 320px widths and short screens must keep amount, scan, and QR controls usable. */
export const PayNowSmallPhone: Story = {
  parameters: {
    viewport: {
      options: {
        smallWallet: { name: "Small phone 320 × 568", styles: { width: "320px", height: "568px" }, type: "mobile" },
      },
    },
  },
  globals: { viewport: { value: "smallWallet", isRotated: false } },
  args: { topUp: <TopUpPanel transport={waitingTopUp} onPaid={fn()} /> },
  play: async ({ canvas }) => {
    await userEvent.click(within(canvas.getByRole("region", { name: "Balance" })).getByRole("button", { name: "Add funds" }));
    const modal = within(document.body).getByRole("dialog", { name: "Add funds to your wallet" });
    const topUp = within(modal);
    await expect(topUp.getByRole("textbox", { name: "Amount (S$)" })).toBeVisible();
    await expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth + 2);
    await userEvent.click(topUp.getByRole("button", { name: "Continue with PayNow" }));
    await expect(await topUp.findByRole("img", { name: /PayNow QR code/ })).toBeVisible();
    await expect(topUp.getByRole("link", { name: /Simulate scan/ })).toBeVisible();
    await userEvent.click(topUp.getByRole("button", { name: "Show larger QR code" }));
    await expect(topUp.getByRole("button", { name: "Reduce QR code" })).toHaveAttribute("aria-expanded", "true");
    await expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth + 2);
  },
};

const confirmedTopUp: TopUpTransport = {
  startPayNow: async (cents) => ({ status: "ready", session: { ...mockPayNowSession, amountCents: cents } }),
  checkPayment: async () => ({ status: "paid" }),
};

/** Stable success state for the screenshot script (no play() that closes the dialog). */
export const PayNowConfirmedScreenshotCapture: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { topUp: <TopUpPanel transport={confirmedTopUp} onPaid={fn()} /> },
};

export const PayNowConfirmationPreview: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: { topUp: <TopUpPanel transport={confirmedTopUp} onPaid={fn()} /> },
  play: async ({ canvas }) => {
    const add = within(canvas.getByRole("region", { name: "Balance" })).getByRole("button", { name: "Add funds" });
    await userEvent.click(add);
    const modal = within(document.body).getByRole("dialog", { name: "Add funds to your wallet" });
    await userEvent.click(within(modal).getByRole("button", { name: "Continue with PayNow" }));
    await expect(await within(modal).findByRole("heading", { name: "Payment confirmed!" })).toBeVisible();
    await expect(within(modal).getByText("pi_test_mock")).toBeVisible();
    await userEvent.click(within(modal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog", { name: "Add funds to your wallet" })).not.toBeInTheDocument());
    await userEvent.click(add);
    await expect(within(document.body).getByRole("textbox", { name: "Amount (S$)" })).toHaveValue("20");
  },
};

const withoutSimulatorTopUp: TopUpTransport = {
  startPayNow: async (cents) => ({ status: "ready", session: {
    ...mockPayNowSession,
    amountCents: cents,
    qrCode: { ...mockPayNowSession.qrCode, testPaymentUrl: undefined },
  } }),
  checkPayment: async () => ({ status: "pending" }),
};

export const PayNowNoSimulatorFallback: Story = {
  args: { topUp: <TopUpPanel transport={withoutSimulatorTopUp} onPaid={fn()} /> },
  play: async ({ canvas }) => {
    await userEvent.click(within(canvas.getByRole("region", { name: "Balance" })).getByRole("button", { name: "Add funds" }));
    const modal = within(document.body).getByRole("dialog", { name: "Add funds to your wallet" });
    await userEvent.click(within(modal).getByRole("button", { name: "Continue with PayNow" }));
    await expect(await within(modal).findByText(/did not provide a test scan link/)).toBeVisible();
    await expect(within(modal).queryByRole("link", { name: /Simulate scan/ })).not.toBeInTheDocument();
    await expect(within(modal).getByRole("link", { name: /Open Stripe payment instructions/ })).toBeVisible();
  },
};

export const DesignPreview: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: {
    summary: {
      status: "ready",
      data: {
        availableBalanceCents: 12850,
        heldBalanceCents: 2400,
        pendingPayoutCents: 0,
        activeHolds: [
          { holdId: "preview-hold-1", sessionId: "preview-session-1", heldCents: 1200, originalCents: 1200, venueName: "Court 1", sport: "Badminton", startAt: "2026-10-20T11:00:00Z" },
          { holdId: "preview-hold-2", sessionId: "preview-session-2", heldCents: 1200, originalCents: 1200, venueName: "Tennis Court A", sport: "Tennis", startAt: "2026-10-21T10:00:00Z" },
        ],
      },
    },
    history: {
      status: "ready",
      data: {
        items: [
          { transactionId: "preview-t8", kind: "TOP_UP", amountCents: 5000, occurredAt: "2026-10-20T06:32:00Z" },
          { transactionId: "preview-t7", kind: "LOCK", amountCents: 2400, occurredAt: "2026-10-19T10:11:00Z" },
          { transactionId: "preview-t6", kind: "RELEASE", amountCents: 3200, occurredAt: "2026-10-18T13:04:00Z" },
          { transactionId: "preview-t5", kind: "REFUND", amountCents: 1600, occurredAt: "2026-10-16T01:15:00Z" },
          { transactionId: "preview-t4", kind: "PAYOUT", amountCents: 4500, occurredAt: "2026-10-12T08:27:00Z" },
          { transactionId: "preview-t3", kind: "FORFEIT", amountCents: 2800, occurredAt: "2026-10-10T04:03:00Z" },
          { transactionId: "preview-t2", kind: "REFUND", amountCents: 2000, occurredAt: "2026-10-08T11:44:00Z" },
          { transactionId: "preview-t1", kind: "TOP_UP", amountCents: 10000, occurredAt: "2026-10-05T03:10:00Z" },
          ...Array.from({ length: 16 }, (_, index) => ({
            transactionId: `preview-older-${index}`,
            kind: (["LOCK", "REFUND", "RELEASE", "PAYOUT"] as const)[index % 4]!,
            amountCents: 900 + index * 125,
            occurredAt: new Date(Date.UTC(2026, 9, 4 - index, 8, 30)).toISOString(),
          })),
        ],
        nextCursor: null,
      },
    },
  },
};

const tomorrowEvening = new Date();
tomorrowEvening.setUTCDate(tomorrowEvening.getUTCDate() + 1);
tomorrowEvening.setUTCHours(11, 0, 0, 0);

/** The mobile reference has its own balances and short activity list. */
export const MobileDesignPreview: Story = {
  parameters: {
    viewport: {
      options: {
        referenceMobile: { name: "Reference mobile (350px)", styles: { width: "350px", height: "760px" }, type: "mobile" },
      },
    },
  },
  globals: { viewport: { value: "referenceMobile", isRotated: false } },
  args: {
    summary: {
      status: "ready",
      data: {
        availableBalanceCents: 12850,
        heldBalanceCents: 4200,
        pendingPayoutCents: 1850,
        activeHolds: [
          { holdId: "mobile-hold", sessionId: "mobile-session", heldCents: 1250, originalCents: 1250, venueName: "Jurong East", sport: "Badminton", startAt: tomorrowEvening.toISOString() },
        ],
      },
    },
    history: {
      status: "ready",
      data: {
        items: [
          { transactionId: "mobile-release", kind: "RELEASE", amountCents: 850, occurredAt: new Date(Date.now() - 86_400_000).toISOString(), sport: "Badminton" },
          { transactionId: "mobile-hold", kind: "LOCK", amountCents: 1200, occurredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), sport: "Tennis" },
          { transactionId: "mobile-top-up", kind: "TOP_UP", amountCents: 5000, occurredAt: "2026-08-22T08:00:00Z" },
        ],
        nextCursor: null,
      },
    },
  },
  play: async ({ canvas }) => {
    const balanceElement = canvas.getByRole("region", { name: "Balance" });
    const balance = within(balanceElement);
    await expect(balance.getByText("$128.50")).toBeVisible();
    await expect(balance.getByText("$42.00")).toBeVisible();
    await expect(balance.getByText("$18.50")).toBeVisible();
    await expect(balance.getByRole("link", { name: "Withdraw" })).toHaveAttribute("href", "/payouts");
    await expect(balanceElement.getAnimations({ subtree: true })).toHaveLength(0);
    const transactions = within(canvas.getByRole("list", { name: "Transactions" }));
    await expect(transactions.getAllByRole("listitem")).toHaveLength(3);
    await expect(transactions.getByText("Payment released")).toBeVisible();
    await expect(transactions.getByText("Badminton · Yesterday")).toBeVisible();
    await expect(transactions.getByText(/Tennis/)).toBeVisible();
    // Release settles a held share to the booker; it does not credit this wallet.
    await expect(transactions.getByText("$8.50")).toBeVisible();
    await expect(transactions.queryByText("+$8.50")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("table", { name: "Transactions" })).not.toBeInTheDocument();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const DesktopPagination: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: DesignPreview.args,
  play: async ({ canvas }) => {
    const table = within(await canvas.findByRole("table", { name: "Transactions" }));
    await expect(table.getAllByRole("row")).toHaveLength(9);
    const firstPage = table.getAllByRole("row")[1]!.textContent;
    await expect(canvas.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }));
    await expect(table.getAllByRole("row")).toHaveLength(9);
    await expect(table.getAllByRole("row")[1]!.textContent).not.toBe(firstPage);
    await expect(canvas.getByRole("button", { name: "Previous page" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Page 3" }));
    await expect(table.getAllByRole("row")).toHaveLength(9);
    await expect(canvas.getByRole("button", { name: "Next page" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Page 1" }));
    await expect(table.getAllByRole("row")[1]!.textContent).toBe(firstPage);
  },
};
