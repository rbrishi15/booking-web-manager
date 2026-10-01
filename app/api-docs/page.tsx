import type { Metadata } from "next";
import { SessionApiReference } from "./swagger-ui";

export const metadata: Metadata = { title: "API reference | Booking Web Manager" };

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold">API reference</h1>
      <p className="mt-2 text-gray-600">
        Read the session API contract below. To try a request, authorize with a
        Supabase access token for an eligible booker. Requests run against this server.
      </p>
      <SessionApiReference />
    </main>
  );
}
