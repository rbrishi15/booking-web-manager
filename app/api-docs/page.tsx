import type { Metadata } from "next";
import { SessionApiReference } from "./swagger-ui";

export const metadata: Metadata = { title: "API reference | Booking Web Manager" };

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold">API reference</h1>
      <p className="mt-2 text-gray-600">
        Explore the session API below. Session creation requires server
        configuration; missing settings return 503. No credentials are needed to
        view this reference.
      </p>
      <SessionApiReference />
    </main>
  );
}
