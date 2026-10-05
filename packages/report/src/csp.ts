import { createHash } from "node:crypto";
import { SCRIPT } from "./styles.ts";

/** SHA-256 (base64) of the one inline script, so a Content-Security-Policy can allow exactly that script. */
export const REPORT_SCRIPT_SHA256 = createHash("sha256").update(SCRIPT).digest("base64");

/**
 * CSP for a hosted report: nothing may load from anywhere; inline styles (the heat-grid colours are style
 * attributes) and the single hashed inline script are the only exceptions; the page cannot be framed.
 */
export const REPORT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  `script-src 'sha256-${REPORT_SCRIPT_SHA256}'`,
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
