import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { expect } from "storybook/test";

/** Every colour token in app/globals.css, grouped by what it is for. */
const TOKEN_GROUPS = [
  {
    group: "Surfaces",
    tokens: [
      { name: "background", use: "Page background behind cards" },
      { name: "card", use: "Cards, inputs, the sidebar" },
      { name: "secondary", use: "Quiet boxes (e.g. the three totals on Delete account)" },
      { name: "border", use: "Card and input borders" },
    ],
  },
  {
    group: "Text",
    tokens: [
      { name: "foreground", use: "Normal text" },
      { name: "muted-foreground", use: "Secondary text, captions, placeholders" },
    ],
  },
  {
    group: "Actions",
    tokens: [
      { name: "primary", use: "Main buttons (+ Create session), avatars" },
      { name: "info", use: "Info button, InfoNote border, Medium reliability" },
      { name: "destructive", use: "Delete buttons, errors, danger badges" },
      { name: "ring", use: "Keyboard focus ring" },
    ],
  },
  {
    group: "Status tints",
    tokens: [
      { name: "success", use: "Confirmed / High reliability text" },
      { name: "success-muted", use: "Confirmed / High reliability background" },
      { name: "info-muted", use: "InfoNote and info badge background" },
    ],
  },
] as const;

/** One colour: a swatch, its token and Tailwind names, what it's for, and its current HSL value. */
function Swatch({ name, use }: { readonly name: string; readonly use: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");

  // Read the live value, so the same story shows the light or dark value depending on the theme.
  useEffect(() => {
    if (ref.current !== null) setValue(getComputedStyle(ref.current).getPropertyValue(`--${name}`).trim());
  });

  return (
    <div ref={ref} className="overflow-hidden rounded-lg border bg-card">
      <div className="h-16 border-b" style={{ background: `hsl(var(--${name}))` }} aria-hidden />
      <div className="space-y-1 p-3 text-sm">
        <p className="font-semibold">{name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          --{name} · {value === "" ? "…" : `hsl(${value})`}
        </p>
        <p className="text-xs text-muted-foreground">{use}</p>
      </div>
    </div>
  );
}

/** All colour tokens as swatches. Wrap in `.dark` to show the dark values. */
function Palette() {
  return (
    <div className="space-y-6 bg-background p-4 text-foreground">
      {TOKEN_GROUPS.map(({ group, tokens }) => (
        <section key={group} className="space-y-2" aria-label={group}>
          <h2 className="text-lg font-semibold">{group}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tokens.map((token) => (
              <Swatch key={token.name} name={token.name} use={token.use} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta = {
  title: "Foundations/Colors",
  component: Palette,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The colour tokens from `app/globals.css`. Use them through Tailwind classes such as `bg-primary`, " +
          "`text-muted-foreground` or `border-border`, never raw hex values, so every screen stays consistent and " +
          "meets WCAG AA contrast. The values are HSL; the theme button in the toolbar switches light and dark.",
      },
    },
  },
} satisfies Meta<typeof Palette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The light theme the app uses today (matches the SRS mockups). */
export const SemanticLight: Story = {
  name: "Semantic / light",
  play: async ({ canvas }) => {
    await expect(canvas.getByText("primary")).toBeInTheDocument();
    await expect(canvas.getByText("destructive")).toBeInTheDocument();
  },
};

/** The same tokens with the `.dark` class applied. */
export const SemanticDark: Story = {
  name: "Semantic / dark",
  render: () => (
    <div className="dark">
      <Palette />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const dark = canvasElement.querySelector(".dark");
    await expect(dark).not.toBeNull();
    // The dark theme really swaps the values (the page background turns near-black).
    await expect(getComputedStyle(dark!).getPropertyValue("--background").trim()).toBe("224 71.4% 4.1%");
  },
};