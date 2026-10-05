import { existsSync } from "node:fs";
import { DISCLAIMER } from "@evalprop/report";
import puppeteer, { type Browser } from "puppeteer-core";
import type { PdfRenderer } from "./render-job.ts";

/** Where a Chromium or Chrome binary usually lives, in the order we try them. `CHROME_PATH` always wins. */
export const COMMON_CHROME_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/** `CHROME_PATH` if set, else the first common install path that exists, else null. */
export function findChrome(env: { CHROME_PATH?: string | undefined } = process.env, exists: (p: string) => boolean = existsSync): string | null {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  return COMMON_CHROME_PATHS.find((p) => exists(p)) ?? null;
}

export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;

export class PdfRenderTimeoutError extends Error {
  constructor(ms: number) {
    super(`PDF render did not finish within ${ms} ms`);
    this.name = "PdfRenderTimeoutError";
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Page margins for the PDF. The web report's own print CSS sets `@page { margin: 12mm }`, which leaves no room
 * for the footer, so the worker appends a later `@page` rule (the last rule wins) that keeps the same side and
 * top margins and gives the bottom enough room for the disclaimer and page numbers. The report package is not
 * touched; the override lives here.
 */
export const PRINT_OVERRIDE_CSS = [
  "@page{size:Letter;margin:12mm 12mm 24mm 12mm}",
  // A section's heading, its one-line description and any figure strip stay with whatever follows (a chart, table
  // or list). The report's print CSS already avoids a break after h2/h3; this extends it over the description,
  // which otherwise let "Long-term hold" and its intro sit alone at the foot of a page.
  "section.card>h2,section.card>.sub,section.card>.metaline,section h3,section h4,.sub{break-after:avoid}",
].join("");

/**
 * The footer on every page: the full disclaimer and "Page X of Y". Chromium renders this template in its own
 * document, so it must carry its own inline styles and cannot use the report's CSS. Text is static (the
 * disclaimer constant), never user content.
 */
export const FOOTER_TEMPLATE = `<div style="box-sizing:border-box;width:100%;padding:0 12mm;font:7.5px/1.35 Helvetica,Arial,'Liberation Sans',sans-serif;color:#52514e;-webkit-print-color-adjust:exact">
<div style="border-top:0.5px solid #cfcec8;padding-top:3px">${escapeHtml(DISCLAIMER)}</div>
<div style="display:flex;justify-content:space-between;margin-top:2px;color:#6f6e69"><span>evalprop rental analysis</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>
</div>`;

/** Adds the print overrides just before `</head>`, so they come after the report's own styles. */
export function withPrintOverrides(html: string): string {
  const tag = `<style>${PRINT_OVERRIDE_CSS}</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : tag + html;
}

/** Runs in the page: resolves once fonts are loaded and two animation frames of layout have passed. */
const SETTLE_SCRIPT = "document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))";

export interface ChromiumRendererOptions {
  /** Path to the Chromium/Chrome binary. Default: {@link findChrome}. */
  executablePath?: string;
  /**
   * Passes `--no-sandbox`. Only for the container image, where Chromium cannot create its sandbox as a non-root
   * user without extra privileges (`CHROMIUM_NO_SANDBOX=1` in the Dockerfile). Off by default, so a developer's
   * machine never runs Chrome unsandboxed.
   */
  noSandbox?: boolean;
  /** One timeout for the whole render, browser start-up included. Default 30 s. */
  timeoutMs?: number;
}

/**
 * Headless Chromium via puppeteer-core. A fresh browser per render: the worker runs at concurrency 1 and scales
 * to zero, so a long-lived browser would only add a way for one report's state to reach the next.
 *
 * The page is loaded from a string, never from a URL, with all network requests blocked (a report is
 * self-contained, so there is nothing legitimate to fetch).
 */
export class ChromiumPdfRenderer implements PdfRenderer {
  readonly #executablePath: string;
  readonly #noSandbox: boolean;
  readonly #timeoutMs: number;

  constructor(options: ChromiumRendererOptions = {}) {
    const path = options.executablePath ?? findChrome();
    if (!path) throw new Error("no Chromium found: set CHROME_PATH to a Chromium or Chrome binary");
    this.#executablePath = path;
    this.#noSandbox = options.noSandbox ?? false;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  }

  async render(html: string): Promise<Uint8Array> {
    const timeoutMs = this.#timeoutMs;
    let browser: Browser | undefined;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PdfRenderTimeoutError(timeoutMs)), timeoutMs);
    });
    // If the race is lost to the timeout, the work promise may reject later when the browser is killed.
    const work = (async () => {
      browser = await puppeteer.launch({
        executablePath: this.#executablePath,
        headless: true,
        args: ["--disable-gpu", "--font-render-hinting=none", ...(this.#noSandbox ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] : [])],
      });
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (/^(data|about|blob):/.test(req.url())) void req.continue();
        else void req.abort();
      });
      await page.setContent(withPrintOverrides(html), { waitUntil: "load", timeout: timeoutMs });
      // System fonts only, but wait for them and for two frames of layout before printing.
      await page.evaluate(SETTLE_SCRIPT);
      await page.emulateMediaType("print");
      return await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: FOOTER_TEMPLATE,
        waitForFonts: true,
        timeout: timeoutMs,
      });
    })();
    // If the timeout wins while Chromium is still starting, close whatever browser appears afterwards too.
    void work.then(() => closeQuietly(browser), () => closeQuietly(browser));
    try {
      return await Promise.race([work, timedOut]);
    } finally {
      clearTimeout(timer);
      await closeQuietly(browser);
    }
  }
}

async function closeQuietly(browser: Browser | undefined): Promise<void> {
  if (!browser) return;
  const proc = browser.process();
  try {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5_000))]);
  } catch {
    // fall through to the kill below
  }
  if (proc && proc.exitCode === null) proc.kill("SIGKILL");
}
