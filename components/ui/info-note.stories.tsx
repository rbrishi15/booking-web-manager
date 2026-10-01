import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { InfoNote } from "./info-note";

const meta = {
  title: "Design system/InfoNote",
  component: InfoNote,
  parameters: {
    docs: {
      description: {
        component:
          "A calm, slate-blue note for helpful information that isn't an error, e.g. how held funds work or " +
          "\"Your profile has been saved.\" Turn on `icon` for an ⓘ symbol.",
      },
    },
  },
  argTypes: {
    children: { control: "text", description: "The note text." },
    icon: { control: "boolean", description: "Show the ⓘ icon.", table: { defaultValue: { summary: "false" } } },
    className: { control: false },
  },
  args: {
    children: "Funds are held in your wallet and released to the booker after attendance is verified.",
    icon: true,
  },
} satisfies Meta<typeof InfoNote>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Edit the text and switch the icon on and off in Controls. */
export const Playground: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText(String(args.children))).toBeInTheDocument();
  },
};

export const WithoutIcon: Story = { args: { icon: false, children: "You can leave only by asking the owner to remove you." } };