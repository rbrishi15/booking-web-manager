import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { AppShell } from "./app-shell";
import { BookingLogo } from "./booking-logo";
import { PageHeader } from "./page-header";

const meta = {
  title: "Design system/AppShell",
  component: AppShell,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/groups" } },
    docs: {
      description: {
        component:
          "The signed-in frame used by every signed-in layout (`<SignedInShell>`). From 768px up it shows an inset, sticky " +
          "Booking. sidebar with icon navigation, account details and logout. A softly faded court image sits behind the page introduction. " +
          "Below that, it shows a Booking. header, decorative sport photo and floating Home / Sessions / Wallet / Settings navigation. " +
          "Only the active mobile destination shows its label; the other icons retain accessible names. Groups belongs to the Sessions area " +
          "and remains reachable from the account sheet. The account button opens that accessible sheet with account details, settings and logout. " +
          "The current page is highlighted and marked `aria-current=\"page\"`. Mobile links and controls have 44px touch targets. Change the page with the " +
          "`nextjs.navigation.pathname` parameter and the user with the `user` control.",
      },
    },
  },
  argTypes: {
    user: {
      description: "The logged-in user: `{ name, reliabilityScore }`. The score is 0–100 and shows as x.x out of 5.",
    },
    logoutAction: { control: false, description: "Server action for the Log out button. Hidden when omitted." },
    children: { control: false, description: "The page content, usually a `<PageHeader>` plus the page body." },
  },
  args: {
    user: { name: "Marcus Lim", reliabilityScore: 96 },
    children: (
      <>
        <PageHeader breadcrumb="Groups" title="My groups" />
        <div className="p-4 text-muted-foreground md:p-8">Page content</div>
      </>
    ),
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit the user in Controls to see long names and different reliability scores. */
export const Playground: Story = {};

export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Main" });
    // The current page's link is marked for screen readers and highlighted.
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("Groups");
    await expect(canvas.getByText("Reliability 4.8")).toBeInTheDocument();
    await expect(within(nav).getAllByRole("link")).toHaveLength(6);
    await expect(canvas.getByRole("link", { name: "Booking." })).toHaveAttribute("href", "/");
    await expect(canvas.queryByRole("link", { name: "+ Create session" })).not.toBeInTheDocument();
  },
};

export const DesktopHome: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/" } } },
  args: {
    children: (
      <div className="p-8 lg:p-12">
        <h1><BookingLogo className="text-5xl" /></h1>
        <p className="mt-3 text-muted-foreground">Find games, meet players, and make time for play.</p>
      </div>
    ),
  },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Main" });
    await expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  },
};

export const DesktopDark: Story = {
  ...DesktopHome,
  globals: { theme: "dark", viewport: { value: "desktop", isRotated: false } },
};

export const DesktopLongName: Story = {
  ...DesktopHome,
  args: {
    ...DesktopHome.args,
    user: { name: "Alexandria Catherine Tan Wei Ling", reliabilityScore: 88 },
  },
};

export const DesktopLogout: Story = {
  ...DesktopHome,
  args: { ...DesktopHome.args, logoutAction: fn().mockResolvedValue(undefined) },
  play: async ({ canvas, args }) => {
    const sidebar = within(canvas.getByRole("complementary"));
    await expect(sidebar.getByText("Marcus Lim")).toBeVisible();
    await userEvent.click(sidebar.getByRole("button", { name: "Log out" }));
    await expect(args.logoutAction).toHaveBeenCalledOnce();
  },
};

export const OnSettings: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/profile/edit" } } },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Main" });
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("Settings");
  },
};

const mobileDestinations = [
  { label: "Home", href: "/" },
  { label: "Sessions", href: "/sessions" },
  { label: "Wallet", href: "/wallet" },
  { label: "Settings", href: "/profile" },
] as const;

async function expectMobileNavigation(nav: HTMLElement, activeLabel: string) {
  const navigation = within(nav);
  await expect(navigation.getAllByRole("link")).toHaveLength(4);
  await expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  const activeLink = navigation.getByRole("link", { name: activeLabel });
  await expect(activeLink).toHaveAttribute("aria-current", "page");

  for (const { label, href } of mobileDestinations) {
    const link = navigation.getByRole("link", { name: label });
    const text = within(link).getByText(label, { exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(link.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    if (label === activeLabel) {
      await expect(text).not.toHaveClass("sr-only");
      await expect(text).toBeVisible();
    } else {
      await expect(text).toHaveClass("sr-only");
      await expect(link).not.toHaveAttribute("aria-current");
      await expect(activeLink.getBoundingClientRect().width).toBeGreaterThan(link.getBoundingClientRect().width);
    }
  }
}

/** The active destination expands to show its label; the other destinations stay as named icons. */
export const PhoneHome: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/" } } },
  args: {
    children: <div className="px-6 pb-6"><h1 className="text-xl font-bold">Discover sessions</h1></div>,
  },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Main" });
    await expectMobileNavigation(nav, "Home");
    await expect(canvas.queryByRole("link", { name: "+ Create session" })).not.toBeInTheDocument();
  },
};

export const PhoneSearchPreservesOrigin: Story = {
  ...PhoneHome,
  parameters: { nextjs: { navigation: { pathname: "/", query: { sport: "Tennis", region: "East" } } } },
  play: async ({ canvas }) => {
    const search = canvas.getByRole("link", { name: "Search sessions" });
    const destination = new URL(search.getAttribute("href")!, "https://booking.invalid");
    await expect(destination.pathname).toBe("/discover");
    await expect(destination.searchParams.get("returnTo")).toBe("/?sport=Tennis&region=East");
    await expect(search.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(canvas.getByRole("button", { name: "Open account menu" })).toBeVisible();
  },
};

export const DesktopDiscover: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/discover", query: { returnTo: "/profile" } } } },
  args: { mobileVariant: "focused" },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Main" });
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("Discover");
    await expect(within(nav).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    await expect(within(nav).getByRole("link", { name: "Discover" })).toHaveAttribute("href", "/discover?returnTo=%2Fprofile");
  },
};

export const PhoneSessions: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/sessions" } } },
  args: { children: <div className="px-6 pb-6">Sessions page content</div> },
  play: async ({ canvas }) => {
    await expectMobileNavigation(canvas.getByRole("navigation", { name: "Main" }), "Sessions");
  },
};

export const PhoneWallet: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/wallet" } } },
  args: { children: <div className="px-6 pb-6">Wallet page content</div> },
  play: async ({ canvas }) => {
    await expectMobileNavigation(canvas.getByRole("navigation", { name: "Main" }), "Wallet");
  },
};

/** Existing group pages are part of the Sessions area. */
export const PhoneGroups: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/groups/example" } } },
  play: async ({ canvas }) => {
    await expectMobileNavigation(canvas.getByRole("navigation", { name: "Main" }), "Sessions");
  },
};

export const PhoneSettings: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: { nextjs: { navigation: { pathname: "/profile/edit" } } },
  play: async ({ canvas }) => {
    await expectMobileNavigation(canvas.getByRole("navigation", { name: "Main" }), "Settings");
  },
};

export const PhoneKeyboardNavigation: Story = {
  ...PhoneHome,
  play: async ({ canvas }) => {
    const navigation = within(canvas.getByRole("navigation", { name: "Main" }));
    const home = navigation.getByRole("link", { name: "Home" });
    home.focus();
    await expect(home).toHaveFocus();
    for (const { label } of mobileDestinations.slice(1)) {
      await userEvent.tab();
      await expect(navigation.getByRole("link", { name: label })).toHaveFocus();
    }
  },
};

export const PhoneDark: Story = {
  ...PhoneHome,
  globals: { theme: "dark", viewport: { value: "phone", isRotated: false } },
};

/** Account settings is available in the sheet and choosing it closes the sheet. */
export const PhoneAccountClosesAfterChoosingSettings: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, step }) => {
    const menuButton = canvas.getByRole("button", { name: "Open account menu" });
    await expect(menuButton).toBeVisible();

    await step("Open the account sheet", async () => {
      await userEvent.click(menuButton);
      const menu = await screen.findByRole("dialog", { name: "Your account" });
      await expect(menu).toBeVisible();
      await expect(within(menu).getByText("Marcus Lim")).toBeVisible();
      await expect(within(menu).getByText("Reliability 4.8")).toBeVisible();
    });

    await step("Choose account settings: the sheet closes", async () => {
      const menu = screen.getByRole("dialog", { name: "Your account" });
      await userEvent.click(within(menu).getByRole("link", { name: "Account settings" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your account" })).not.toBeInTheDocument());
    });
  },
};

export const PhoneAccountGroups: Story = {
  ...PhoneHome,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open account menu" }));
    const menu = await screen.findByRole("dialog", { name: "Your account" });
    const groups = within(menu).getByRole("link", { name: "My groups" });
    await expect(groups).toHaveAttribute("href", "/groups");
    await expect(groups.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(groups);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your account" })).not.toBeInTheDocument());
  },
};

/** Escape and Close restore keyboard focus to the account trigger. */
export const PhoneAccountDismissalRestoresFocus: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas }) => {
    const menuButton = canvas.getByRole("button", { name: "Open account menu" });
    await userEvent.click(menuButton);
    await screen.findByRole("dialog", { name: "Your account" });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your account" })).not.toBeInTheDocument());
    await waitFor(() => expect(menuButton).toHaveFocus());

    await userEvent.click(menuButton);
    const menu = await screen.findByRole("dialog", { name: "Your account" });
    await userEvent.click(within(menu).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your account" })).not.toBeInTheDocument());
    await waitFor(() => expect(menuButton).toHaveFocus());
  },
};

export const PhoneAccountLogout: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  args: { logoutAction: fn().mockResolvedValue(undefined) },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open account menu" }));
    const menu = await screen.findByRole("dialog", { name: "Your account" });
    const logoutButton = within(menu).getByRole("button", { name: "Log out" });
    await expect(logoutButton).toBeVisible();
    await expect(logoutButton.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.click(logoutButton);
    await expect(args.logoutAction).toHaveBeenCalledOnce();
    await userEvent.keyboard("{Escape}");
  },
};
