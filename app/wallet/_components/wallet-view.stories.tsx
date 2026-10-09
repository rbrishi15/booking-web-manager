import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { firstTransactionsPage, walletSummary } from "./wallet-fixtures";
import { WalletView } from "./wallet-view";

const meta = {
  title: "Wallet/Overview",
  component: WalletView,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/wallet" } } },
  globals: { viewport: { value: "phone", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Joseph", reliabilityScore: 100 }} logoutAction={fn()}><Story /></AppShell>],
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

export const Populated: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText("S$25.00")).toBeVisible();
    await expect(canvas.getByText("S$18.75")).toBeVisible();
    const holds = within(canvas.getByRole("region", { name: "Held for sessions" }));
    await expect(holds.getByText("Bishan Sports Hall")).toBeVisible();
    await expect(holds.getByText(/of/)).toHaveTextContent("of S$12.50");
    await expect(canvas.getByText("Held for a session")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Load more" }));
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
    summary: { status: "ready", data: { availableBalanceCents: 0, heldBalanceCents: 0, activeHolds: [] } },
    history: { status: "ready", data: { items: [], nextCursor: null } },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Nothing held right now")).toBeVisible();
    await expect(canvas.getByText("No transactions yet")).toBeVisible();
    await expect(canvas.getAllByText("S$0.00")).toHaveLength(2);
  },
};

export const LoadingMore: Story = {
  args: { loadingMore: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Loading…" })).toBeDisabled();
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
    await expect(canvas.getByText("S$25.00")).toBeVisible();
  },
};
