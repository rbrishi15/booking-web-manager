import { invalidRequest } from "@/app/http/request-failure";
import { parseDiscoveryQuery } from "./query";

/** Adapts the shared URL parser for HTTP requests without changing form validation. */
export function readDiscoveryRequest(request: Request) {
  const parsed = parseDiscoveryQuery(new URL(request.url).searchParams);
  if (parsed.status === "invalid")
    throw invalidRequest("Invalid session discovery query");
  return { criteria: parsed.criteria, after: parsed.after };
}
