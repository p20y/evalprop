/** Palette from the report (packages/report/src/styles.ts), tuned for a transparent chat surface. */
export const WIDGET_COLORS = {
  light: {
    ink: "#14130f",
    ink2: "#4d4b45",
    surface: "#f6f5f1",
    line: "#dcdad2",
    accent: "#1f5fb4",
    accentInk: "#ffffff",
    goodInk: "#0a5c0a",
    goodBg: "#e5f4e5",
    warnInk: "#6b4a00",
    warnBg: "#fff1cc",
    poorInk: "#9d2222",
    poorBg: "#fde8e8",
  },
  dark: {
    ink: "#f1f0ec",
    ink2: "#bdbbb3",
    surface: "#23221f",
    line: "#3b3a35",
    accent: "#8db8f0",
    accentInk: "#0b1b30",
    goodInk: "#8fe08f",
    goodBg: "#14301a",
    warnInk: "#f5cd5e",
    warnBg: "#3a2d08",
    poorInk: "#ffa3a3",
    poorBg: "#421919",
  },
} as const;

type Palette = Record<keyof (typeof WIDGET_COLORS)["light"], string>;

function vars(p: Palette): string {
  return (
    `--ink:${p.ink};--ink-2:${p.ink2};--surface:${p.surface};--line:${p.line};--accent:${p.accent};--accent-ink:${p.accentInk};` +
    `--good-ink:${p.goodInk};--good-bg:${p.goodBg};--warn-ink:${p.warnInk};--warn-bg:${p.warnBg};--poor-ink:${p.poorInk};--poor-bg:${p.poorBg}`
  );
}

/**
 * Light by default, dark through `prefers-color-scheme` or an explicit `data-theme` on `<html>` (set from the
 * host's theme when it provides one; an explicit value wins over the media query). Layout is mobile first
 * (works from 280px); two columns of tiles become four from 480px.
 */
export const WIDGET_CSS = `
:root{color-scheme:light;${vars(WIDGET_COLORS.light)}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;${vars(WIDGET_COLORS.dark)}}}
:root[data-theme=dark]{color-scheme:dark;${vars(WIDGET_COLORS.dark)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:transparent;color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.deal{max-width:640px;margin:0 auto;padding:14px}
.loading,.unavailable{margin:0;padding:14px;color:var(--ink-2)}
.eyebrow{margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.addr{margin:2px 0 4px;font-size:18px;line-height:1.25;font-weight:700;letter-spacing:-.005em}
.facts{margin:0 0 10px;color:var(--ink-2);font-size:13px}
.facts span{display:inline-block;margin-right:12px}
.pill{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 12px 5px 9px;border-radius:999px;border:2px solid currentColor;font-weight:700;font-size:14px;line-height:1.25}
.pill svg{width:18px;height:18px;flex:none}
.t-good{color:var(--good-ink);background:var(--good-bg)}
.t-ok{color:var(--warn-ink);background:var(--warn-bg)}
.t-poor{color:var(--poor-ink);background:var(--poor-bg)}
.t-neutral{color:var(--ink-2)}
.ico{width:14px;height:14px;flex:none;vertical-align:-2px}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 0}
.tile{margin:0;padding:10px 10px 9px;background:var(--surface);border:1px solid var(--line);border-radius:10px;min-width:0}
.tile dt{font-size:12px;color:var(--ink-2)}
.tile dd{margin:0}
.tile .v{display:block;margin-top:1px;font-size:20px;line-height:1.2;font-weight:700;letter-spacing:-.01em}
.tile .u{display:block;margin-top:2px;font-size:11px;color:var(--ink-2)}
.kv{margin:12px 0 0;border-top:1px solid var(--line)}
.kv .row{display:grid;grid-template-columns:minmax(0,1fr);gap:1px;padding:8px 0;border-bottom:1px solid var(--line)}
.kv dt{font-size:12px;color:var(--ink-2)}
.kv dd{margin:0;font-weight:600}
.kv dd small{display:block;font-weight:400;color:var(--ink-2);font-size:12px}
.status{display:inline-flex;align-items:center;gap:5px;font-weight:600;padding:2px 9px 2px 6px;border-radius:999px}
.status.t-neutral{padding-left:0}
.compare{margin:12px 0 0}
.compare h2,.notes summary{font-size:13px;margin:0 0 6px;font-weight:700}
.compare table{width:100%;border-collapse:collapse;font-size:13px}
.compare th,.compare td{padding:7px 4px 7px 10px;border-bottom:1px solid var(--line);vertical-align:top;text-align:right}
.compare th:first-child,.compare td:first-child{text-align:left;padding-left:0}
.compare td:last-child,.compare th:last-child{padding-right:0}
.compare thead th{font-size:11px;font-weight:600;color:var(--ink-2);border-bottom-color:var(--ink-2)}
.compare tbody th{font-weight:500}
.compare .after{font-weight:700}
.delta{display:flex;align-items:center;justify-content:flex-end;gap:3px;margin-top:1px;font-size:11px;font-weight:600;background:none}
.notes{margin:12px 0 0;padding:8px 10px;background:var(--surface);border:1px solid var(--line);border-radius:10px}
.notes summary{cursor:pointer;margin:0;display:flex;align-items:center;gap:6px}
.notes ul{margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:13px}
.notes li{margin:3px 0}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 14px;border-radius:9px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;flex:1 1 130px;text-align:center}
.btn.primary{background:var(--accent);color:var(--accent-ink);border:2px solid var(--accent)}
.btn.secondary{background:transparent;color:var(--ink);border:2px solid var(--ink-2)}
.btn:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.hint{margin:8px 0 0;font-size:12px;color:var(--ink-2)}
.hint[hidden]{display:none}
.foot{margin:12px 0 0;font-size:11px;color:var(--ink-2)}
@media (min-width:480px){
  .deal{padding:16px 18px}
  .tiles{grid-template-columns:repeat(4,minmax(0,1fr))}
  .kv .row{grid-template-columns:150px minmax(0,1fr);gap:12px;align-items:baseline}
  .addr{font-size:20px}
}
`;
