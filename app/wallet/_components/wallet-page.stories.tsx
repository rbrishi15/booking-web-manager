import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { WalletLoad, WalletTransactionsPage, WalletTransport } from "../wallet-transport";
import { useWalletScreen } from "../wallet-queries";
import { WalletView } from "./wallet-view";
import { firstTransactionsPage, secondTransactionsPage, walletSummary } from "./wallet-fixtures";

/** Renders exactly what app/wallet/page.tsx renders, with a fake wallet API. */
function WalletPageHarness({ transport }: { readonly transport: WalletTransport }) {
  return <WalletView {...useWalletScreen(transport)} />;
}

function transport(overrides: Partial<WalletTransport> = {}): WalletTransport {
  return {
    loadSummary: fn<WalletTransport["loadSummary"]>(async () => ({ status: "ready", data: walletSummary })),
    loadTransactions: fn<WalletTransport["loadTransactions"]>(async (before) => ({ status: "ready", data: before ? secondTransactionsPage : firstTransactionsPage })),
    ...overrides,
  };
}

const meta = {
  title: "Wallet/Page",
  component: WalletPageHarness,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "phone", isRotated: false } },
  // A fresh cache per story, as each browser tab gets in the app.
  decorators: [(Story) => {
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return <QueryClientProvider client={client}><Story /></QueryClientProvider>;
  }],
  args: { transport: transport() },
} satisfies Meta<typeof WalletPageHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Load more appends the next page and never lists the repeated boundary transaction twice. */
export const LoadMore: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(canvas.getByText("Top-up")).toBeVisible());
    await expect(within(canvas.getByRole("list", { name: "Transactions" })).getAllByRole("listitem")).toHaveLength(3);
    await expect(args.transport.loadTransactions).toHaveBeenLastCalledWith("2045-03-30T08:00:00Z");
    await expect(canvas.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
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
        : { status: "ready", data: walletSummary };
    }),
  }) },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText(/temporarily unavailable/)).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(canvas.getByText("S$25.00")).toBeVisible());
  },
};

/** An expired login during Load more shows the Log in action, like the first load does. */
export const LoadMoreAfterLoginExpired: Story = {
  args: { transport: transport({
    loadTransactions: fn<WalletTransport["loadTransactions"]>(async (before) => before
      ? { status: "error", code: "UNAUTHENTICATED", message: "Log in again to see your wallet." }
      : { status: "ready", data: firstTransactionsPage }),
  }) },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Load more" }));
    const history = within(canvas.getByRole("region", { name: "Transactions" }));
    await waitFor(() => expect(history.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Fwallet"));
  },
};

/** A login that expires before a background refresh (returning to the tab) shows Log in, not the old list. */
let refreshAttempts = 0;
export const RefreshAfterLoginExpired: Story = {
  beforeEach: () => { refreshAttempts = 0; },
  args: { transport: transport({
    loadTransactions: fn<WalletTransport["loadTransactions"]>(async () => {
      refreshAttempts += 1;
      return refreshAttempts === 1
        ? { status: "ready", data: firstTransactionsPage }
        : { status: "error", code: "UNAUTHENTICATED", message: "Log in again to see your wallet." };
    }),
  }) },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "Load more" });
    // Leaving and returning to the tab makes React Query refresh the wallet in the background.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    focusManager.setFocused(undefined);
    const history = within(canvas.getByRole("region", { name: "Transactions" }));
    await waitFor(() => expect(history.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Fwallet"));
    await expect(history.queryByRole("list", { name: "Transactions" })).not.toBeInTheDocument();
  },
};

/** A Load more whose request throws shows an error and leaves Load more usable (no stuck button). */
let throwingAttempts = 0;
export const LoadMoreRequestThrows: Story = {
  beforeEach: () => { throwingAttempts = 0; },
  args: { transport: transport({
    loadTransactions: fn<WalletTransport["loadTransactions"]>(async (before) => {
      if (!before) return { status: "ready", data: firstTransactionsPage };
      throwingAttempts += 1;
      if (throwingAttempts === 1) throw new Error("offline");
      return { status: "ready", data: secondTransactionsPage };
    }),
  }) },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(canvas.getByText(/check your connection/i)).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(canvas.getByText("Top-up")).toBeVisible());
  },
};

/** A Load more that finishes after a Retry belongs to the old list and is discarded. */
let resolveOldPage: ((page: WalletLoad<WalletTransactionsPage>) => void) | undefined;
let staleSummaryAttempts = 0;
export const LoadMoreAfterRetryIsDiscarded: Story = {
  beforeEach: () => { resolveOldPage = undefined; staleSummaryAttempts = 0; },
  args: { transport: transport({
    loadSummary: fn<WalletTransport["loadSummary"]>(async () => {
      staleSummaryAttempts += 1;
      return staleSummaryAttempts === 1
        ? { status: "error", code: "WALLET_API_UNAVAILABLE", message: "The wallet is temporarily unavailable. Please try again later." }
        : { status: "ready", data: walletSummary };
    }),
    loadTransactions: fn<WalletTransport["loadTransactions"]>((before) => before
      ? new Promise((resolve) => { resolveOldPage = resolve; })
      : Promise.resolve({ status: "ready", data: firstTransactionsPage })),
  }) },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Load more" }));
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(canvas.getByText("S$25.00")).toBeVisible());
    resolveOldPage!({ status: "ready", data: secondTransactionsPage });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(within(canvas.getByRole("list", { name: "Transactions" })).getAllByRole("listitem")).toHaveLength(2);
    await expect(canvas.queryByText("Top-up")).not.toBeInTheDocument();
  },
};
