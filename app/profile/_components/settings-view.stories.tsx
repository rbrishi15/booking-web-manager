import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Bell } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { SettingsView } from "./settings-view";

const exampleUser = {
  displayName: "Marcus Lim",
  handle: "marcus_lim",
  reliabilityScore: 96,
  preferredSports: ["Badminton", "Tennis"],
  preferredRegions: ["West"],
};

/** Presentation only: the live page supplies the real browser notification control. */
function NotificationsFixture() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:gap-x-5 md:px-6">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
        <Bell className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-[140px] flex-1">
        <span className="block text-sm font-medium md:text-base">Session notifications</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground md:text-sm">Not available in this browser</span>
      </span>
    </div>
  );
}

const meta = {
  title: "Settings/Account",
  component: SettingsView,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/profile" } },
    docs: {
      description: {
        component:
          "The account Settings view inside the real signed-in shell. Profile and preference fixtures " +
          "are deterministic, and notification content is static so these stories never request browser " +
          "permission or contact an account service. Session history remains unavailable until real " +
          "statistics are provided. All settings links retain their application destinations.",
      },
    },
  },
  globals: { viewport: { value: "desktop", isRotated: false } },
  decorators: [(Story, { args }) => (
    <AppShell
      user={{ name: args.user.displayName, reliabilityScore: args.user.reliabilityScore }}
      logoutAction={fn().mockResolvedValue(undefined)}
    >
      <Story />
    </AppShell>
  )],
  argTypes: {
    notifications: { control: false },
  },
  args: {
    user: exampleUser,
    notifications: <NotificationsFixture />,
  },
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectSettingsLinks(main: HTMLElement) {
  const page = within(main);
  for (const [name, href] of [
    [/preferred sports/i, "/profile/edit"],
    [/preferred region/i, "/profile/edit"],
    [/transaction history/i, "/wallet"],
    [/privacy/i, "/privacy"],
    [/help.*support/i, "/profile/help"],
    [/terms.*conditions/i, "/terms"],
    [/delete account/i, "/profile/delete"],
  ] as const) {
    const link = page.getByRole("link", { name });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toBeVisible();
  }
  for (const link of page.getAllByRole("link", { name: /edit profile/i })) {
    await expect(link).toHaveAttribute("href", "/profile/edit");
  }
  await expect(page.queryByText("Coming soon")).not.toBeInTheDocument();
}

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const document = canvasElement.ownerDocument;
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
}

export const Desktop: Story = {
  play: async ({ canvas, canvasElement }) => {
    const main = canvas.getByRole("main");
    const page = within(main);
    await expect(page.getByRole("heading", { name: "Marcus Lim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /account settings/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /preferred sports/i })).toHaveTextContent("Badminton, Tennis");
    await expect(page.getByRole("link", { name: /preferred region/i })).toHaveTextContent("West");
    await expect(page.getByText("Session notifications")).toBeVisible();
    const navigation = within(canvas.getByRole("navigation", { name: "Main" }));
    await expect(navigation.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    await expectSettingsLinks(main);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Phone: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    const main = canvas.getByRole("main");
    const page = within(main);
    await expect(page.getByRole("heading", { name: "Marcus Lim" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /account settings/i })).toBeInTheDocument();
    const navigation = within(canvas.getByRole("navigation", { name: "Main" }));
    await expect(navigation.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    await expectSettingsLinks(main);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const DesktopDark: Story = {
  ...Desktop,
  globals: { theme: "dark", viewport: { value: "desktop", isRotated: false } },
};

export const PhoneDark: Story = {
  ...Phone,
  globals: { theme: "dark", viewport: { value: "phone", isRotated: false } },
};

export const EmptyPreferences: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  args: {
    user: { ...exampleUser, preferredSports: [], preferredRegions: [] },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvas.getByRole("main"));
    await expect(page.getByRole("link", { name: /preferred sports/i })).toHaveTextContent("Not set yet");
    await expect(page.getByRole("link", { name: /preferred region/i })).toHaveTextContent("Not set yet");
    await expectSettingsLinks(canvas.getByRole("main"));
    await expectNoHorizontalOverflow(canvasElement);
  },
};

/** The public user ID appears under the name (ADR-0021). */
export const UserId: Story = {
  play: async ({ canvas }) => {
    const page = within(canvas.getByRole("main"));
    await expect(page.getByText("@marcus_lim", { exact: true })).toBeVisible();
  },
};

/** An unavailable score must not become the starting score. */
export const ReliabilityUnavailable: Story = {
  args: { user: { ...exampleUser, reliabilityScore: null } },
  play: async ({ canvas }) => {
    const main = canvas.getByRole("main");
    const page = within(main);
    await expect(page.getByText("Reliability score unavailable right now.")).toBeVisible();
    await expect(page.queryByText("5.0")).not.toBeInTheDocument();
    await expect(page.queryByText("Reliability", { exact: true })).not.toBeInTheDocument();
    await expectSettingsLinks(main);
  },
};

export const LongNameAndPreferences: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  args: {
    user: {
      displayName: "Alexandria Catherine Tan Wei Ling With An Extended Family Name",
      reliabilityScore: 88,
      preferredSports: ["Badminton", "Basketball", "Football", "Futsal", "Tennis", "Volleyball"],
      preferredRegions: ["Central", "East", "North", "North-East", "West"],
    },
  },
  play: async ({ canvas, canvasElement, args }) => {
    const page = within(canvas.getByRole("main"));
    await expect(page.getByRole("heading", { name: args.user.displayName })).toBeVisible();
    await expect(page.getByRole("link", { name: /preferred sports/i })).toHaveTextContent(args.user.preferredSports.join(", "));
    await expect(page.getByRole("link", { name: /preferred region/i })).toHaveTextContent(args.user.preferredRegions.join(", "));
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const KeyboardPreferences: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas }) => {
    const page = within(canvas.getByRole("main"));
    const sports = page.getByRole("link", { name: /preferred sports/i });
    const regions = page.getByRole("link", { name: /preferred region/i });
    sports.focus();
    await expect(sports).toHaveFocus();
    await userEvent.tab();
    await expect(regions).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(sports).toHaveFocus();
  },
};
