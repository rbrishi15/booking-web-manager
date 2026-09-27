import type { UUID } from "@/domain";

/**
 * The platform holding account seeded by migration 0001.
 *
 * Every committed share pools here until it is released, refunded or
 * forfeited. It is a constant rather than a lookup because there is exactly
 * one, and a query per commitment to discover that would be wasted work.
 */
export const PLATFORM_HOLDING_ACCOUNT_ID: UUID =
  "00000000-0000-4000-8000-000000000001";
