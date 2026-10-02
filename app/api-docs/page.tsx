import type { Metadata } from "next";
import { ApiReference } from "./swagger-ui";

export const metadata: Metadata = { title: "API reference | Booking Web Manager" };

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <ApiReference />
    </main>
  );
}
