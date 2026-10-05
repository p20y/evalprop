import type { ReadResourceResult, Resource } from "@modelcontextprotocol/sdk/types.js";
import { WIDGET_HTML } from "@evalprop/widget";

/**
 * How the inline deal card is registered with ChatGPT (S09). Mechanism, doc links and what could not be
 * verified: `docs/chatgpt-widget.md`. Re-checked against OpenAI's Apps SDK documentation on 2026-10-04.
 *
 *  - The widget is an MCP resource: `resources/list` advertises it, `resources/read` returns the HTML with the
 *    MCP Apps MIME type `text/html;profile=mcp-app` (OpenAI's earlier `text/html+skybridge` is the legacy one).
 *  - Tools link to it through their descriptor `_meta`: `ui.resourceUri` (the standard key, preferred) plus
 *    `openai/outputTemplate` (ChatGPT's alias for the same URI).
 *  - The resource's own `_meta` carries presentation and security hints: a border, the CSP allow-lists
 *    (all empty: the widget fetches nothing and loads nothing), the widget domain when one is configured,
 *    and, in the legacy `openai/widgetCSP`, `redirect_domains` so the report link can go through `openExternal`.
 *  - A client that ignores `_meta` or does not fetch UI resources still gets `content[0].text` and
 *    `structuredContent` from the tools; nothing depends on the widget.
 */

/** The resource URI the tools point at. Versioned: change it (and keep the old one served) if the markup changes incompatibly, because hosts cache templates. */
export const WIDGET_RESOURCE_URI = "ui://widget/deal-card-v1.html";

/** MCP Apps UI resource MIME type. */
export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

const WIDGET_NAME = "deal-card";
const WIDGET_TITLE = "Rental deal card";
const WIDGET_DESCRIPTION = "Inline card with the verdict, key return metrics, maximum offer and break-even for a property analysis.";

export interface WidgetRegistrationOptions {
  /** Public origin of this server (the card's report link points here). Enables `redirect_domains`. */
  baseUrl?: string;
  /**
   * Dedicated origin for the widget (`ui.domain`). OpenAI requires one for app submission and hosts the
   * sandbox on `https://web-sandbox.oaiusercontent.com` when it is unset. Unset until S16 settles the domain.
   */
  widgetDomain?: string;
}

/** Descriptor `_meta` for a tool whose result the card renders. */
export function widgetToolMeta(status: { invoking: string; invoked: string }): Record<string, unknown> {
  return {
    ui: { resourceUri: WIDGET_RESOURCE_URI },
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
    // Short status lines ChatGPT shows while the tool runs and after it finishes (documented limit: 64 characters).
    "openai/toolInvocation/invoking": status.invoking,
    "openai/toolInvocation/invoked": status.invoked,
  };
}

/** `_meta` for the resource itself (on the `resources/list` entry and on the `resources/read` content). */
export function widgetResourceMeta(options: WidgetRegistrationOptions = {}): Record<string, unknown> {
  const origin = options.baseUrl === undefined ? undefined : originOf(options.baseUrl);
  const domain = options.widgetDomain === undefined ? undefined : originOf(options.widgetDomain);
  return {
    ui: {
      prefersBorder: true,
      // Nothing is fetched and nothing external is loaded: empty allow-lists, deliberately explicit.
      csp: { connectDomains: [], resourceDomains: [] },
      ...(domain !== undefined ? { domain } : {}),
    },
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: [],
      resource_domains: [],
      // The report link is opened through `openExternal`, which only follows these origins.
      ...(origin !== undefined ? { redirect_domains: [origin] } : {}),
    },
    ...(domain !== undefined ? { "openai/widgetDomain": domain } : {}),
    "openai/widgetDescription":
      "A card with the verdict, four headline metrics, maximum offer, break-even, 10-year IRR and data notes is already shown to the user. Do not repeat these figures in detail; add only what the card does not say.",
  };
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** The `resources/list` entries. */
export function listWidgetResources(options: WidgetRegistrationOptions = {}): Resource[] {
  return [
    {
      uri: WIDGET_RESOURCE_URI,
      name: WIDGET_NAME,
      title: WIDGET_TITLE,
      description: WIDGET_DESCRIPTION,
      mimeType: WIDGET_MIME_TYPE,
      _meta: widgetResourceMeta(options),
    },
  ];
}

/** `resources/read` for the widget, or null when the URI is not one of ours. */
export function readWidgetResource(uri: string, options: WidgetRegistrationOptions = {}): ReadResourceResult | null {
  if (uri !== WIDGET_RESOURCE_URI) return null;
  return { contents: [{ uri: WIDGET_RESOURCE_URI, mimeType: WIDGET_MIME_TYPE, text: WIDGET_HTML, _meta: widgetResourceMeta(options) }] };
}
