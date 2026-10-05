import type { Confidence, Source, Tone, Verdict } from "@evalprop/shared";
import { esc, fmtDate } from "./format.ts";

/** Status tones. Each pairs a distinct icon SHAPE with a text label, so colour is never the only signal. */
export type StatusTone = Tone;

const ICON_ID: Record<StatusTone, string> = { good: "i-check", ok: "i-warn", poor: "i-x", neutral: "i-dash" };

/** Inline icon referencing the symbol sprite emitted once per document. */
export function icon(tone: StatusTone, small = false): string {
  return `<svg class="ico${small ? " sm" : ""} i-${tone}" aria-hidden="true" focusable="false"><use href="#${ICON_ID[tone]}"/></svg>`;
}

export function infoIcon(small = false): string {
  return `<svg class="ico${small ? " sm" : ""} i-neutral" aria-hidden="true" focusable="false"><use href="#i-info"/></svg>`;
}

/** Icon plus visible text label. */
export function status(tone: StatusTone, label: string): string {
  return `<span class="status t-${tone}">${icon(tone, true)}<span>${esc(label)}</span></span>`;
}

/** SVG symbols used by {@link icon}. Circle/triangle/cross/dash shapes differ, not just their colours. */
export const ICON_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<symbol id="i-check" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M5.8 10.4l2.9 2.9 5.5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-warn" viewBox="0 0 20 20"><path d="M10 1.8L19 17.6H1z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 7.4v5M10 14.2v.2" stroke="#1a1200" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="i-x" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6.8 6.8l6.4 6.4M13.2 6.8l-6.4 6.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="i-dash" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.2 10h7.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
<symbol id="i-info" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9v5M10 6.2v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></symbol>
</defs></svg>`;

export const VERDICT_TONE: Record<Verdict, StatusTone> = { strong: "good", good: "good", marginal: "ok", weak: "poor" };

export const CONFIDENCE: Record<Confidence, { tone: StatusTone; label: string }> = {
  high: { tone: "good", label: "High confidence" },
  medium: { tone: "ok", label: "Medium confidence" },
  low: { tone: "poor", label: "Low confidence" },
};

export const TONE_LABEL: Record<StatusTone, string> = { good: "Positive", ok: "Watch", poor: "Concern", neutral: "Note" };

export interface SourceInfo {
  source: Source;
  provider?: string;
  fetchedAt?: string;
}

/** The badge text from the requirements: Provided / From listing / Looked up (provider, date) / Assumed default. */
export function sourceBadge(s: SourceInfo): string {
  switch (s.source) {
    case "provided":
      return `<span class="tag src-provided">Provided</span>`;
    case "listing":
      return `<span class="tag src-listing">From listing</span>`;
    case "lookup": {
      const detail = [s.provider, s.fetchedAt ? fmtDate(s.fetchedAt) : undefined].filter(Boolean).join(", ");
      return `<span class="tag src-lookup">Looked up${detail ? ` (${esc(detail)})` : ""}</span>`;
    }
    case "assumed":
      return `<span class="tag src-assumed">Assumed default</span>`;
  }
}

/** A titled card section. Omitted sections are never rendered as empty boxes. */
export function section(id: string, title: string, sub: string | null, body: string): string {
  return `<section class="card" id="${esc(id)}" aria-labelledby="${esc(id)}-h"><h2 id="${esc(id)}-h">${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}${body}</section>`;
}
