import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { AppShell } from "./app-shell";
import { PageHeader } from "./page-header";

/** The signed-in frame: sidebar on desktop, ☰ menu below 768px. */
const meta = {
  title: "Design system/AppShell",
  component: AppShell,
  argTypes: { children: { control: false }, logoutAction: { control: false } },
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/groups" } },
  },
  args: {
    user: { name: "Marcus Lim", reliabilityScore: 96 },
    children: (
      <>
        <PageHeader breadcrumb="Groups" title="My groups" />
        <div className="p-4 md:p-8 text-muted-foreground">Page content</div>
      </>
    ),
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Main" });
    // The current page's link is marked for screen readers and highlighted.
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("Groups");
    await expect(canvas.getByText("Reliability 4.8")).toBeInTheDocument();
  },
};

export const OnSettings: Story = {
  parameters: { nextjs: { navigation: { pathname: "/profile/edit" } } },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole("navigation", { name: "Main" });
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("Settings");
  },
};