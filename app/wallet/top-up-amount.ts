export const MIN_TOP_UP_CENTS = 100;
export const MAX_TOP_UP_CENTS = 100_000;

export type TopUpAmount =
  | { readonly status: "valid"; readonly cents: number }
  | { readonly status: "invalid"; readonly message: string };

/**
 * Reads an SGD amount typed by the user ("20", "20.5", "20.50") as integer
 * cents. Dollars and cents are split by pattern and combined with integer
 * arithmetic, never through a floating-point parse (CLAUDE.md rule #1).
 */
export function parseTopUpAmount(text: string): TopUpAmount {
  const match = /^\s*(?:S?\$\s*)?(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (match === null)
    return { status: "invalid", message: "Enter an amount in dollars, such as 20 or 20.50." };
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (cents < MIN_TOP_UP_CENTS) return { status: "invalid", message: "The minimum top-up is S$1.00." };
  if (cents > MAX_TOP_UP_CENTS) return { status: "invalid", message: "The maximum top-up is S$1,000.00." };
  return { status: "valid", cents };
}
