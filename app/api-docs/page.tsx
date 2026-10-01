import type { Metadata } from "next";
import { SessionApiReference } from "./swagger-ui";

export const metadata: Metadata = { title: "API reference | Booking Web Manager" };

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold">API reference</h1>
      <p className="mt-2 text-gray-600">
        Explore session discovery and creation below. Both require server
        configuration; missing settings return 503. No credentials are needed to
        view this reference. Try it out sends a real request and requires an
        active account&apos;s Supabase bearer token.
      </p>
      <SessionApiReference />
    </main>
  );
}
