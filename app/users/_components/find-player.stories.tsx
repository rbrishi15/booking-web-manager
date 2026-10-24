import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { FindPlayerState } from "../find-player-action";
import { FindPlayer } from "./find-player";

/** Stands in for the server action: answers every search with `result`. */
function answering(result: FindPlayerState) {
  return fn<(previous: FindPlayerState, formData: FormData) => Promise<FindPlayerState>>(async () => result);
}

const meta = {
  title: "Groups/FindPlayer",
  component: FindPlayer,
  parameters: {
    docs: {
      description: {
        component: "Search for one player by exact user ID (ADR-0021). Shows the player's name, @id and reliability score.",
      },
    },
  },
  args: {
    action: answering({ status: "found", player: { handle: "marcus_lim", displayName: "Marcus Lim", reliabilityScore: 96 } }),
  },
} satisfies Meta<typeof FindPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Found: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "User ID" }), "@Marcus_Lim");
    await userEvent.click(canvas.getByRole("button", { name: "Find" }));

    await expect(await canvas.findByText("Marcus Lim")).toBeVisible();
    await expect(canvas.getByText("@marcus_lim")).toBeVisible();
    await expect(canvas.getByText(/Reliability 4\.8/)).toBeVisible();
    await expect(args.action).toHaveBeenCalledOnce();
    // The field already shows "@", so a typed one is dropped.
    await expect(canvas.getByRole("textbox", { name: "User ID" })).toHaveValue("Marcus_Lim");
  },
};

export const NotFound: Story = {
  args: { action: answering({ status: "not-found", handle: "nobody_here" }) },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "User ID" }), "nobody_here");
    await userEvent.click(canvas.getByRole("button", { name: "Find" }));

    await expect(await canvas.findByText("No player has the user ID @nobody_here.")).toBeVisible();
  },
};

/** An unavailable score is said so, never shown as the starting score. */
export const ScoreUnavailable: Story = {
  args: { action: answering({ status: "found", player: { handle: "marcus_lim", displayName: "Marcus Lim", reliabilityScore: null } }) },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "User ID" }), "marcus_lim");
    await userEvent.click(canvas.getByRole("button", { name: "Find" }));

    await expect(await canvas.findByText("Reliability score unavailable right now.")).toBeVisible();
    await expect(canvas.queryByText(/Reliability 5\.0/)).not.toBeInTheDocument();
  },
};

/** A malformed ID is explained at once, without asking the server. */
export const InvalidId: Story = {
  play: async ({ args, canvas }) => {
    const input = canvas.getByRole("textbox", { name: "User ID" });
    await userEvent.type(input, "9lives");
    await userEvent.click(canvas.getByRole("button", { name: "Find" }));

    await expect(canvas.getByText("Start with a letter")).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("Start with a letter");
    await expect(args.action).not.toHaveBeenCalled();
  },
};

export const Phone: Story = {
  globals: { viewport: { value: "phone", isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "User ID" }), "marcus_lim");
    await userEvent.click(canvas.getByRole("button", { name: "Find" }));

    await expect(await canvas.findByText("Marcus Lim")).toBeVisible();
    const root = within(canvasElement);
    await expect(root.getByRole("button", { name: "Find" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(canvasElement.ownerDocument.defaultView?.innerWidth ?? 0);
  },
};
