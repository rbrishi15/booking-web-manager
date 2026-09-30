import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Button } from "./button";
import { PageHeader } from "./page-header";

const meta = {
  title: "Design system/PageHeader",
  component: PageHeader,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The white bar at the top of every signed-in page: a small breadcrumb, the page title (the page's only " +
          "`<h1>`), and optional action buttons on the right that wrap underneath on phones.",
      },
    },
  },
  argTypes: {
    breadcrumb: { control: "text", description: "Optional small text above the title, e.g. \"Account\"." },
    title: { control: "text", description: "The page title (rendered as the page's `<h1>`)." },
    actions: { control: false, description: "Optional buttons on the right, e.g. `<Button>Share</Button>`." },
  },
  args: { breadcrumb: "Account", title: "Settings" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit the breadcrumb and title in Controls. */
export const Playground: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1, name: args.title })).toBeInTheDocument();
  },
};

export const WithActions: Story = {
  args: {
    breadcrumb: "Sessions",
    title: "Session details",
    actions: (
      <>
        <Button variant="outline">Share</Button>
        <Button>Commit to this session</Button>
      </>
    ),
  },
};

export const TitleOnly: Story = { args: { breadcrumb: undefined, title: "My groups" } };