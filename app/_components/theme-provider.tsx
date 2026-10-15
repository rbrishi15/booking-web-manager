"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Applies the device's color scheme to the app's existing Tailwind palettes. */
export function ThemeProvider({ children }: { readonly children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
