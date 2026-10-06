import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AppShell } from "@/components/ui/app-shell";
import { PageUnavailableView } from "./page-unavailable-view";

const meta = {
  title: "Navigation/Unavailable pages",
  component: PageUnavailableView,
  parameters: { layout: "fullscreen", nextjs: { navigation: { pathname: "/wallet" } } },
  render: (args) => {
    const content = <PageUnavailableView {...args} />;
    return args.kind === "not-found" && !args.signedIn ? <main>{content}</main>
      : <AppShell user={{ name: "Alex Tan", reliabilityScore: 90 }}>{content}</AppShell>;
  },
} satisfies Meta<typeof PageUnavailableView>;
export default meta;
type Story = StoryObj<typeof PageUnavailableView>;

export const Wallet: Story = { args: { kind: "development", feature: "Wallet" } };
export const MobileWallet: Story = { ...Wallet, globals: { viewport: { value: "phone", isRotated: false } } };
export const SignedInNotFound: Story = {
  args: { kind: "not-found", signedIn: true },
  parameters: { nextjs: { navigation: { pathname: "/missing-page" } } },
};
export const MobileNotFound: Story = { ...SignedInNotFound, globals: { viewport: { value: "phone", isRotated: false } } };
export const PublicNotFound: Story = { args: { kind: "not-found", signedIn: false } };
export const DarkWallet: Story = { ...Wallet, globals: { theme: "dark" } };
