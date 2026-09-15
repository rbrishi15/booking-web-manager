import { NextResponse } from "next/server";

// Stripe webhook handler — the sole writer for inbound money (see CLAUDE.md rule #2).
// Signature verification, event-ID dedup and ledger crediting land here.
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
