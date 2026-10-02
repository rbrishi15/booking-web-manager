import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BookingLogo } from "./booking-logo";

const meta = {
  title: "Foundations/Booking logo",
  component: BookingLogo,
  parameters: {
    docs: { description: { component: "The Booking. wordmark matches Figma node 2116:12362: Inter Black (900), 20px, normal line height and zero letter spacing. Inter is bundled locally and shared by Next.js and Storybook. Navigation and authentication use the exact 20px size; the desktop discovery heading uses the same typeface at display scale. Dark mode uses the foreground token for contrast." } },
  },
} satisfies Meta<typeof BookingLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const Display: Story = { args: { className: "text-5xl lg:text-6xl" } };
