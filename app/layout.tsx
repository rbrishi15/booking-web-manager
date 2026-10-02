import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Booking Web Manager",
  description: "Sports venue booking coordination",
};

/** Wraps every page in the document shell with the Inter font and base theme styles. */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/inter-v20-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
