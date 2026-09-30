import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { ErrorMessage } from "./error-message";
import { InfoNote } from "./info-note";
import { LoadingSpinner } from "./loading-spinner";

/** Empty, error, information and loading states used across the app. */
const meta = {
  title: "Design system/Feedback",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => (
    <EmptyState
      title="No groups yet"
      description="Create a group for the people you play with, then share its invitation link."
      action={<Button>Create group</Button>}
    />
  ),
};

export const Error: Story = {
  render: () => <ErrorMessage>Invalid email or password.</ErrorMessage>,
  play: async ({ canvas }) => {
    // role="alert" makes screen readers announce the error straight away.
    await expect(canvas.getByRole("alert")).toHaveTextContent("Invalid email or password.");
  },
};

export const Info: Story = {
  render: () => (
    <InfoNote icon>Funds are held in your wallet and released to the booker after attendance is verified.</InfoNote>
  ),
};

export const Loading: Story = {
  render: () => <LoadingSpinner label="Loading sessions…" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading sessions…");
  },
};