import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { AppShell } from "@/components/ui/app-shell";
import { exampleBookings, exampleWeather, longVenueBooking, overnightBooking } from "./home-fixtures";
import { HomeView } from "./home-view";

const meta = {
  title: "Home/Desktop dashboard",
  component: HomeView,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/" } },
    docs: { description: { component: "Desktop Home preserves the Booking sidebar and court backdrop, with compact date-and-booking cards in two columns. When no personal bookings are scheduled, the content becomes a Singapore weather forecast. Filters and public session results live exclusively on Discover. These states use the same synchronous HomeView as mobile and have no database, authentication, or weather-service dependency." } },
  },
  globals: { viewport: { value: "desktop", isRotated: false } },
  decorators: [(Story) => <AppShell user={{ name: "Marcus Lim", reliabilityScore: 96 }} logoutAction={fn()}><Story /></AppShell>],
  args: { state: { status: "ready", bookings: exampleBookings }, onRetry: fn() },
} satisfies Meta<typeof HomeView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Upcoming Bookings" })).toBeVisible();
    await expect(canvas.getAllByRole("article")).toHaveLength(2);
    await expect(canvas.queryByRole("button", { name: /filter/i })).not.toBeInTheDocument();
    await expect(canvas.getByRole("navigation", { name: "Main" }).querySelector('[aria-current="page"]')).toHaveTextContent("Home");
    await expect(canvas.getByRole("link", { name: "Discover" })).toHaveAttribute("href", "/discover?returnTo=%2F");
  },
};
export const NoBookingsWeather: Story = { args: { state: { status: "empty", weather: exampleWeather } } };
export const WeatherUnavailable: Story = { args: { state: { status: "empty", weather: { status: "unavailable" } } } };
export const Loading: Story = { args: { state: { status: "loading" } } };
export const Unavailable: Story = { args: { state: { status: "error", kind: "unavailable" } } };
export const UnexpectedFailure: Story = { args: { state: { status: "error", kind: "unexpected" } } };
export const LongVenueName: Story = { args: { state: { status: "ready", bookings: [longVenueBooking, exampleBookings[1]] } } };
export const Overnight: Story = { args: { state: { status: "ready", bookings: [overnightBooking] } } };
export const Dark: Story = { globals: { theme: "dark" } };
export const DarkWeather: Story = { args: { state: { status: "empty", weather: exampleWeather } }, globals: { theme: "dark" } };
