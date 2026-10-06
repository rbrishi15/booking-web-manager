import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SignedInVerificationPrompt } from "./signed-in-verification-prompt";

const meta = {
  title: "Auth/Email verification prompt",
  component: SignedInVerificationPrompt,
  parameters: { layout: "fullscreen" },
  args: { user: { accountStatus: "ACTIVE", email: "viewer@example.com", pendingEmail: null, emailVerified: false } },
} satisfies Meta<typeof SignedInVerificationPrompt>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Unconfirmed: Story = {};
export const MissingEmail: Story = { args: { user: { accountStatus: "ACTIVE", email: null, pendingEmail: null, emailVerified: false } } };
export const PendingAddition: Story = { args: { user: { accountStatus: "ACTIVE", email: null, pendingEmail: "viewer@example.com", emailVerified: false } } };
export const Verified: Story = { args: { user: { accountStatus: "ACTIVE", email: "viewer@example.com", pendingEmail: null, emailVerified: true } } };
export const Mobile: Story = { globals: { viewport: { value: "phone", isRotated: false } } };
