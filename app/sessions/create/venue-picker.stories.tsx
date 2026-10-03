import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn, userEvent, waitFor } from "storybook/test";
import type { VenueSearchPage } from "@/lib/venues/contracts";
import { emptySessionDraft } from "./model";
import type { SearchVenues } from "./transport";
import { VenuePicker } from "./venue-picker";

const venues: VenueSearchPage = {
  items: ["First court", "Second court", "Last court"].map((venueName, index) => ({
    venueName, address: `${index + 1} COURT ROAD`, postalCode: "596569",
    latitude: 1.34, longitude: 103.77, region: "Central",
  })),
  nextPage: null,
};

function Harness(props: ComponentProps<typeof VenuePicker>) {
  const [draft, setDraft] = useState(props.draft);
  return <div className="max-w-lg space-y-4 p-4">
    <VenuePicker {...props} draft={draft} onChange={(patch) => {
      props.onChange(patch);
      setDraft((previous) => ({ ...previous, ...patch }));
    }} />
    <button type="button">Continue</button>
  </div>;
}

const meta = {
  title: "Sessions/Venue picker", component: VenuePicker,
  render: (args) => <Harness {...args} />,
  args: { draft: emptySessionDraft, errors: {}, disabled: false, onChange: fn(), search: fn<SearchVenues>(async () => venues) },
} satisfies Meta<typeof VenuePicker>;
export default meta;
type Story = StoryObj<typeof VenuePicker>;

function deferredPage() {
  let resolve!: (page: VenueSearchPage) => void;
  const promise = new Promise<VenueSearchPage>((finish) => { resolve = finish; });
  return { promise, resolve };
}

export const EscapeWhileLoading: Story = {
  play: async ({ canvas, args }) => {
    const pending = deferredPage();
    const search = args.search as ReturnType<typeof fn<SearchVenues>>;
    search.mockImplementationOnce(() => pending.promise);
    const input = canvas.getByRole("combobox", { name: "Venue" });
    await userEvent.type(input, "Court");
    await waitFor(() => expect(search).toHaveBeenCalledOnce());
    await userEvent.keyboard("{Escape}");
    pending.resolve(venues);
    await waitFor(() => expect(canvas.queryByText("Searching OneMap…")).not.toBeInTheDocument());
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(input).toHaveValue("First court");
  },
};

export const ArrowUpStartsAtLastResult: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole("combobox", { name: "Venue" });
    await userEvent.type(input, "Court");
    await waitFor(() => expect(canvas.getAllByRole("option")).toHaveLength(3));
    await userEvent.keyboard("{ArrowUp}{Enter}");
    await expect(input).toHaveValue("Last court");
  },
};

export const LatePaginationRespectsBlur: Story = {
  play: async ({ canvas, args }) => {
    const pending = deferredPage();
    const search = args.search as ReturnType<typeof fn<SearchVenues>>;
    search.mockImplementation(async (_query, page) => page === 1
      ? { items: venues.items.slice(0, 1), nextPage: 2 }
      : pending.promise);
    const input = canvas.getByRole("combobox", { name: "Venue" });
    await userEvent.type(input, "Court");
    await waitFor(() => expect(canvas.getByRole("option", { name: /First court/ })).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "More venues" }));
    await waitFor(() => expect(search).toHaveBeenCalledWith("Court", 2, expect.any(AbortSignal)));
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    pending.resolve({ items: venues.items.slice(1), nextPage: null });
    await waitFor(() => expect(canvas.queryByText("Searching OneMap…")).not.toBeInTheDocument());
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.click(input);
    await expect(canvas.getAllByRole("option")).toHaveLength(3);
  },
};

export const ManualEntryCancelsSearch: Story = {
  play: async ({ canvas, args }) => {
    const pending = deferredPage();
    const search = args.search as ReturnType<typeof fn<SearchVenues>>;
    search.mockImplementationOnce(() => pending.promise);
    const input = canvas.getByRole("combobox", { name: "Venue" });
    await userEvent.type(input, "Court");
    await waitFor(() => expect(search).toHaveBeenCalledOnce());
    await userEvent.click(canvas.getByRole("button", { name: "Enter venue manually" }));
    pending.resolve(venues);
    await expect(search.mock.calls[0]?.[2].aborted).toBe(true);
    await userEvent.click(input);
    await expect(canvas.queryByRole("listbox")).not.toBeInTheDocument();
    await expect(canvas.getByText("Enter the name of your booked venue and choose its region.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Search OneMap instead" }));
    await waitFor(() => expect(canvas.getAllByRole("option")).toHaveLength(3));
    await expect(search).toHaveBeenCalledTimes(2);
  },
};

export const NewQueryDiscardsPendingPagination: Story = {
  play: async ({ canvas, args }) => {
    const pending = deferredPage();
    const search = args.search as ReturnType<typeof fn<SearchVenues>>;
    search.mockImplementation(async (query, page) => {
      if (query === "Old court") return page === 1
        ? { items: venues.items.slice(0, 1), nextPage: 2 }
        : pending.promise;
      return { items: venues.items.slice(2), nextPage: null };
    });
    const input = canvas.getByRole("combobox", { name: "Venue" });
    await userEvent.type(input, "Old court");
    await waitFor(() => expect(canvas.getByRole("option", { name: /First court/ })).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "More venues" }));
    await waitFor(() => expect(search).toHaveBeenCalledWith("Old court", 2, expect.any(AbortSignal)));
    await userEvent.clear(input);
    await userEvent.type(input, "New court");
    await waitFor(() => expect(canvas.getByRole("option", { name: /Last court/ })).toBeVisible());
    pending.resolve({ items: venues.items.slice(1, 2), nextPage: null });
    await expect(search.mock.calls.find(([query, page]) => query === "Old court" && page === 2)?.[2].aborted).toBe(true);
    await expect(search).toHaveBeenCalledWith("New court", 1, expect.any(AbortSignal));
    await expect(canvas.getAllByRole("option")).toHaveLength(1);
    await expect(canvas.queryByRole("option", { name: /First court|Second court/ })).not.toBeInTheDocument();
  },
};
