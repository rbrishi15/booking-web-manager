import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

/** The type scale used across the app, with where each size is used. */
const SCALE = [
  { className: "text-3xl font-bold", label: "text-3xl · bold", use: "Big amounts (ConfirmDialog, wallet balance)" },
  { className: "text-2xl font-semibold tracking-tight", label: "text-2xl · semibold", use: "Page titles (PageHeader h1)" },
  { className: "text-xl font-semibold", label: "text-xl · semibold", use: "Section headings (Preferences, Members)" },
  { className: "text-base font-medium", label: "text-base · medium", use: "List item titles, names" },
  { className: "text-sm", label: "text-sm · regular", use: "Body text, form labels, buttons" },
  { className: "text-sm text-muted-foreground", label: "text-sm · muted", use: "Descriptions, helper text" },
  { className: "text-xs text-muted-foreground", label: "text-xs · muted", use: "Captions, stat labels" },
] as const;

function TypeScale({ sample }: { readonly sample: string }) {
  return (
    <div className="divide-y rounded-lg border bg-card">
      {SCALE.map((row) => (
        <div key={row.label} className="grid gap-1 p-4 md:grid-cols-[14rem_1fr]">
          <div>
            <p className="font-mono text-xs">{row.label}</p>
            <p className="text-xs text-muted-foreground">{row.use}</p>
          </div>
          <p className={row.className}>{sample}</p>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Foundations/Typography",
  component: TypeScale,
  parameters: {
    docs: {
      description: {
        component:
          "Inter (loaded in `app/layout.tsx`) with Tailwind's size classes. Use these combinations rather than " +
          "custom font sizes. Change the sample text in Controls to check long words and wrapping.",
      },
    },
  },
  argTypes: { sample: { control: "text", description: "Text shown at every size." } },
  args: { sample: "Tired of friends not showing up after bookings?" },
} satisfies Meta<typeof TypeScale>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getAllByText(args.sample)).toHaveLength(SCALE.length);
  },
};