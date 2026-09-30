import type { Preview } from "@storybook/nextjs-vite";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    // Components like AppShell use next/navigation from the App Router.
    nextjs: { appDirectory: true },
    layout: "padded",
    controls: { expanded: true },
    // Accessibility problems fail the story tests, not just show a warning.
    a11y: { test: "error" },
  },
  decorators: [
    (Story) => (
      <div className="bg-background font-sans text-foreground antialiased">
        <Story />
      </div>
    ),
  ],
};

export default preview;