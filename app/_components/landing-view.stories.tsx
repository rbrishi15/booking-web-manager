import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { LandingView } from "./landing-view";

const meta = {
  title: "Landing/Page", component: LandingView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LandingView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: /API docs/ })).toHaveAttribute("href", "/api-docs");
    await expect(canvas.getByRole("link", { name: /Storybook/ })).toHaveAttribute("href", "/storybook");
    await expect(canvas.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  },
};
export const Mobile: Story = { globals: { viewport: { value: "phone", isRotated: false } } };
export const Dark: Story = { ...Mobile, globals: { ...Mobile.globals, theme: "dark" } };
