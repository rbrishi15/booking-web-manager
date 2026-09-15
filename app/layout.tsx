import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Booking Web Manager",
  description: "Sports venue booking coordination",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
