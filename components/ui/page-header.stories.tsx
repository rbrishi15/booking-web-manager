import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Button } from "./button";
import { PageHeader } from "./page-header";

const meta = {
  title: "Design system/PageHeader",
  component: PageHeader,
  argTypes: { actions: { control: false } },
  parameters: { layout: "fullscreen" },
  args: { breadcrumb: "Account", title: "Settings" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBreadcrumb: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
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