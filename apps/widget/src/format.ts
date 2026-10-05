/**
 * Display formatting. Pure: every number printed is an argument, nothing is computed here beyond rounding
 * for display. Matches the pipeline's summary text (`apps/server/src/pipeline/format.ts`) so the card and
 * the assistant's words never disagree.
 */

/** Escapes text for HTML element content and quoted attribute values. Every dynamic string goes through this. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const DASH = "—";

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** "$1,234", "-$68" (sign first; never "$-68" or "-$0"). */
export function usd(n: number | null | undefined): string {
  if (!finite(n)) return DASH;
  const rounded = Math.round(n);
  const text = Math.abs(rounded).toLocaleString("en-US");
  return `${rounded < 0 ? "-" : ""}$${text}`;
}

/** "7.2%", "8%" when whole, never "-0%". */
export function pct(n: number | null | undefined, digits = 1): string {
  if (!finite(n)) return DASH;
  const fixed = n.toFixed(digits);
  const trimmed = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  return `${trimmed === "-0" ? "0" : trimmed}%`;
}

/** "1.25". */
export function ratio(n: number | null | undefined): string {
  return finite(n) ? n.toFixed(2) : DASH;
}

/** Months as "2 yrs 4 mos", "1 yr", "9 mos", "1 mo". */
export function duration(months: number | null | undefined): string {
  if (!finite(months)) return DASH;
  const m = Math.max(0, Math.round(months));
  const years = Math.floor(m / 12);
  const rest = m % 12;
  const y = `${years} ${years === 1 ? "yr" : "yrs"}`;
  const r = `${rest} ${rest === 1 ? "mo" : "mos"}`;
  if (years === 0) return r;
  return rest === 0 ? y : `${y} ${r}`;
}
