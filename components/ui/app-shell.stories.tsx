import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { AppShell } from "./app-shell";
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
          "The signed-in frame used by every signed-in layout (`<SignedInShell>`). From 768px up it shows a fixed " +
          "sidebar; below that, a top bar with a ☰ button that opens the same navigation in a side sheet. The link " +
          "for the current page is highlighted and marked `aria-current=\"page\"`. Change the page with the " +
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

/** At 390px the sidebar is hidden; the ☰ menu opens it, and choosing a page closes it again. */
export const PhoneMenuClosesAfterChoosingAPage: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, step }) => {
    const menuButton = canvas.getByRole("button", { name: "Open menu" });
    await expect(menuButton).toBeVisible();

    await step("Open the menu", async () => {
      await userEvent.click(menuButton);
      const menu = await screen.findByRole("dialog", { name: "Main menu" });
      await expect(menu).toBeVisible();
    });

    await step("Choose Wallet: the menu closes", async () => {
      const menu = screen.getByRole("dialog", { name: "Main menu" });
      const wallet = [...menu.querySelectorAll("a")].find((link) => link.textContent?.includes("Wallet"));
      await expect(wallet).toBeDefined();
      await userEvent.click(wallet!);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Main menu" })).not.toBeInTheDocument());
    });
  },
};

/** Escape closes the phone menu and puts keyboard focus back on the ☰ button. */
export const PhoneMenuEscapeRestoresFocus: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas }) => {
    const menuButton = canvas.getByRole("button", { name: "Open menu" });
    await userEvent.click(menuButton);
    await screen.findByRole("dialog", { name: "Main menu" });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Main menu" })).not.toBeInTheDocument());
    await waitFor(() => expect(menuButton).toHaveFocus());
  },
};