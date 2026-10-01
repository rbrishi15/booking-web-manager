import { withThemeByClassName } from "@storybook/addon-themes";
import type { Preview } from "@storybook/nextjs-vite";
import "../app/globals.css";

const preview: Preview = {
  // Every component gets an automatic Docs page: description, props table, and all its stories.
  tags: ["autodocs"],
  parameters: {
    // Components like AppShell use next/navigation from the App Router.
    nextjs: { appDirectory: true },
    layout: "padded",
    controls: { expanded: true, sort: "requiredFirst" },
    // Sidebar order: how-to page, then colours and type, then the components.
    options: { storySort: { order: ["Introduction", "Foundations", ["Colors", "Typography"], "Design system"] } },
    // Accessibility problems fail the story tests, not just show a warning.
    a11y: { test: "error" },
    // The SRS requires the app to work from 390px wide (usability NFR).
    viewport: {
      options: {
        phone: { name: "Phone (390px)", styles: { width: "390px", height: "844px" }, type: "mobile" },
        desktop: { name: "Desktop (1280px)", styles: { width: "1280px", height: "800px" }, type: "desktop" },
      },
    },
  },
  decorators: [
    // Toolbar switch between the light and dark colour tokens in app/globals.css (`.dark` class).
    withThemeByClassName({ themes: { light: "", dark: "dark" }, defaultTheme: "light" }),
    (Story) => (
      <div className="bg-background font-sans text-foreground antialiased">
        <Story />
      </div>
    ),
  ],
};

export default preview;