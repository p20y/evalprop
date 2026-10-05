/** Escapes text for HTML element content and quoted attribute values. Every dynamic string goes through this. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DASH = "—";
const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Whole dollars with the sign in front: "$1,200", "-$68" (never "$-68" or "-$0"). */
export function usd(n: number | null | undefined): string {
  if (!finite(n)) return DASH;
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`;
}

/** "$215k", "$1.2M" for chart axes. */
export function usdCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${trim(a / 1_000_000)}M`;
  if (a >= 1_000) return `${sign}$${trim(a / 1_000)}k`;
  return `${sign}$${Math.round(a)}`;
}

function trim(n: number): string {
  return n.toFixed(n >= 100 ? 0 : n >= 10 ? 0 : 1).replace(/\.0$/, "");
}

/** Percent with fixed decimals; avoids "-0.0%". */
export function pct(n: number | null | undefined, digits = 1): string {
  if (!finite(n)) return DASH;
  const s = n.toFixed(digits);
  const clean = /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
  return `${clean}%`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (!finite(n)) return DASH;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function multiple(n: number | null | undefined): string {
  return finite(n) ? `${n.toFixed(2)}x` : DASH;
}

export function ratio(n: number | null | undefined): string {
  return finite(n) ? n.toFixed(2) : DASH;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 1, 2026" in UTC so the output never depends on the server's time zone. */
export function fmtDate(iso: string | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function miles(n: number): string {
  return `${n.toFixed(n < 10 ? 2 : 1)} mi`;
}

export function monthWord(n: number): string {
  return `month ${n}`;
}

/** Round-number ticks covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (min === max) {
    max = min + 1;
  }
  const rawStep = (max - min) / Math.max(1, target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return out;
}

/** Linear blend of two #rrggbb colours; t = 0 gives `a`, t = 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parse(a);
  const pb = parse(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parse(hex: string): number[] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
