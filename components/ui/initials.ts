/** Returns uppercase initials from the first two name parts, e.g. "Marcus Lim" → "ML", or "?" for a blank name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}