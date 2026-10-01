import { Money as DomainMoney } from "@/domain";
import { formatSgd } from "@/lib/money/allocation";

interface MoneyProps {
  readonly cents: number;
  readonly className?: string;
}


/**
 * Displays integer SGD cents as a currency amount with two decimal places.
 * @throws RangeError if cents is not a safe integer.
 */
export function Money({ cents, className }: MoneyProps) {
  return (
    <span className={`tabular-nums ${className ?? ""}`}>
      {formatSgd(DomainMoney.fromCents(cents))}
    </span>
  );
}