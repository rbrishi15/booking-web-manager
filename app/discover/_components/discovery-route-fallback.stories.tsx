import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { DiscoveryRouteFallback } from "./discovery-route-fallback";

const meta = {
  title: "Discover/Route loading fallback",
  component: DiscoveryRouteFallback,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/discover" } },
    docs: { description: { component: "The streamed loading screen shares the responsive Discover layout, so desktop never briefly renders the mobile search page. Its two placeholder cards follow the real card grid in both viewport sizes." } },
  },
  decorators: [(Story) => (
    <AppShell mobileVariant="focused" user={{ name: "Marcus Lim", reliabilityScore: 96 }} logoutAction={fn()}>
      <Story />
    </AppShell>
  )],
} satisfies Meta<typeof DiscoveryRouteFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    const heading = canvas.getByRole("heading", { name: "Upcoming sessions" });
    const search = canvas.getByRole("searchbox", { name: "Search sessions by sport or venue" });
    await expect(heading).toBeVisible();
    await expect(search).toBeDisabled();
    await expect(canvas.queryByRole("link", { name: "Back to previous page" })).not.toBeInTheDocument();
    const cards = canvasElement.querySelectorAll('section[aria-label="Upcoming sessions"] li');
    await expect(cards).toHaveLength(2);
    const first = cards[0]!.getBoundingClientRect();
    const second = cards[1]!.getBoundingClientRect();
    await expect(heading.getBoundingClientRect().bottom).toBeLessThanOrEqual(search.getBoundingClientRect().top);
    await expect(Math.abs(first.top - second.top)).toBeLessThan(2);
    await expect(first.right).toBeLessThanOrEqual(second.left);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("heading", { name: "Find Your Next Game" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Back to previous page" })).toBeVisible();
    await expect(canvas.getByRole("searchbox", { name: "Search sessions by sport or venue" })).toBeDisabled();
    const cards = canvasElement.querySelectorAll('section[aria-label="Upcoming sessions"] li');
    await expect(cards).toHaveLength(2);
    await expect(cards[0]!.getBoundingClientRect().bottom).toBeLessThanOrEqual(cards[1]!.getBoundingClientRect().top);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const RetryError: Story = {
  args: { retry: fn() },
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole("heading", { name: "Upcoming sessions" })).toBeVisible();
    await expect(canvas.queryByRole("searchbox")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.retry).toHaveBeenCalledOnce();
  },
};
