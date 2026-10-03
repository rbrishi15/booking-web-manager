import { Money } from "../finance/money";
import { DomainError } from "../shared/errors";

export interface SessionPricing {
  readonly suggestedCents: number;
  readonly minimumCents: number;
  readonly maximumCents: number;
}

/** UC2-02: a cent-exact starting price and the permitted booker adjustment. */
export function sessionPricing(totalCostCents: number, totalSlots: number): SessionPricing {
  DomainError.require(Number.isSafeInteger(totalCostCents) && totalCostCents > 0,
    "INVALID_INPUT", "A booking cost must be positive safe integer cents");
  DomainError.require(Number.isSafeInteger(totalSlots) && totalSlots >= 2 && totalSlots <= 8,
    "INVALID_INPUT", "A session needs between 2 and 8 slots");
  // Money division uses integer arithmetic even near MAX_SAFE_INTEGER.
  const suggestedCents = Money.fromCents(totalCostCents).divideFloor(totalSlots).toCents();
  DomainError.require(suggestedCents > 0, "INVALID_INPUT", "The booking share must be positive");
  return {
    suggestedCents,
    minimumCents: Math.max(1, Math.ceil(suggestedCents / 2)),
    maximumCents: Math.min(suggestedCents * 2,
      Number(BigInt(Number.MAX_SAFE_INTEGER) / BigInt(totalSlots))),
  };
}

/** The chosen share is validated server-side and remains fixed for the session. */
export function resolveBookingShare(totalCost: Money, slots: number, chosen?: Money): Money {
  const range = sessionPricing(totalCost.toCents(), slots);
  const share = chosen ?? Money.fromCents(range.suggestedCents);
  DomainError.require(share instanceof Money && share.toCents() >= range.minimumCents &&
    share.toCents() <= range.maximumCents, "INVALID_INPUT", "Price per slot must be within the suggested price range");
  return share;
}
