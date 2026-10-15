export const EMAIL_ENDINGS = [".com", ".sg", ".net", ".org"] as const;

export type EmailEnding = (typeof EMAIL_ENDINGS)[number];
export type EmailInputValue =
  | { mode: "split"; address: string; ending: EmailEnding }
  | { mode: "full"; address: string };

/** The form always submits a complete address, even before the field loses focus. */
export function completeEmail(value: EmailInputValue): string {
  if (value.address === "") return "";
  return value.mode === "split" ? `${value.address}${value.ending}` : value.address;
}

function domainDot(address: string): number {
  const at = address.lastIndexOf("@");
  return at < 0 ? -1 : address.indexOf(".", at + 1);
}

/** Keep full-address typing, pasting, and autofill authoritative over the default ending. */
export function editEmail(value: EmailInputValue, address: string): EmailInputValue {
  if (value.mode === "full" || domainDot(address) >= 0) return { mode: "full", address };
  return { ...value, address };
}

/** Only split simple known endings; arbitrary domains remain intact in the text field. */
export function normalizeEmail(value: EmailInputValue): EmailInputValue {
  if (value.mode === "split") return value;
  const dot = domainDot(value.address);
  const ending = EMAIL_ENDINGS.find((candidate) => value.address.slice(dot) === candidate);
  return dot >= 0 && ending
    ? { mode: "split", address: value.address.slice(0, dot), ending }
    : value;
}

export function selectEmailEnding(value: EmailInputValue, ending: EmailEnding | ""): EmailInputValue {
  if (ending === "") return { mode: "full", address: completeEmail(value) };
  if (value.mode === "split" || value.address === "") return { mode: "split", address: value.address, ending };

  const dot = domainDot(value.address) < 0 ? -1 : value.address.lastIndexOf(".");
  const address = dot < 0 ? value.address : value.address.slice(0, dot);
  // Multi-label domains stay visible in full, including the explicitly selected replacement.
  return normalizeEmail({ mode: "full", address: `${address}${ending}` });
}
