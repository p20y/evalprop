# ChatGPT inline deal card (S09)

How the card is registered, what the host gives it, the constraints we rely on, and what we could not verify. Re-read OpenAI's documentation before changing any of this (the keys and the MIME type changed once already, see below), and again for S16 (directory submission).

## Sources (accessed 2026-10-04)

| Doc | URL |
|---|---|
| Build a custom UX (ChatGPT UI): resource MIME type, tool `_meta`, CSP, `window.openai`, MCP Apps bridge, bundling | https://developers.openai.com/apps-sdk/build/chatgpt-ui |
| Reference: complete list of `_meta` keys and `window.openai` members | https://developers.openai.com/apps-sdk/reference |
| Build your MCP server: result shape (`structuredContent` / `content` / `_meta`), annotations | https://developers.openai.com/apps-sdk/build/mcp-server |
| MCP Apps specification (the portable standard the docs now point to): `ui/*` messages, `_meta.ui`, MIME type | https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx |
| Migrating an OpenAI app to MCP Apps: `window.openai` to `ui/*` mapping | https://apps.extensions.modelcontextprotocol.io/api/documents/Migrate_OpenAI_App.html |

The OpenAI pages were read through a summarising fetcher, not a browser, so wording below is the summary's; the MCP Apps spec was read as raw text.

## What changed since ARCHITECTURE §5.3 was written

ARCHITECTURE §5.3 deliberately names no keys, so nothing in it is contradicted. Two things it does not say, and one detail that needs care:

1. **The MIME type is now `text/html;profile=mcp-app`.** Older Apps SDK material and many third-party tutorials still use `text/html+skybridge` and flat `openai/*` keys. The current docs call `ui.*` the standard and the `openai/*` keys compatibility aliases. We emit both, so either kind of host works.
2. **The runtime is moving from `window.openai` to a `postMessage` bridge** (MCP Apps `ui/*` JSON-RPC). The docs say to prefer the standard and use `window.openai` "only for capabilities that the shared specification does not cover". The card supports both (below).
3. **"The widget calls no APIs" needs a footnote.** The card makes no network request and has an empty CSP, but it does talk to the host (post a message, open a link) through the host runtime. That is not a network call from the widget, and it is the only way "Change assumptions" can hand back to the conversation.

`structuredContent` is `{ card, summary }` / `{ baseAnalysisId, card, rows, summary }`, not the bare card (F31); the card reads `structuredContent.card` (and `rows` for a what-if).

## Registration (what the server does)

Code: `apps/server/src/mcp/widget-registration.ts`, wired in `server.ts` and `tools.ts`. Tests: `apps/server/src/mcp/widget.test.ts`.

- **Resource.** `resources/list` advertises one resource, `ui://widget/deal-card-v1.html`, MIME type `text/html;profile=mcp-app`. `resources/read` returns the single self-contained HTML document (inline CSS and script, 17 KB) as `text`. The server declares the `resources` capability. The URI is versioned because hosts cache templates: change the markup incompatibly, bump the version, keep serving the old one for a while.
- **Resource `_meta`** (on the list entry and on the read content): `ui.prefersBorder: true`; `ui.csp: { connectDomains: [], resourceDomains: [] }` (the widget fetches nothing and loads nothing, so nothing is allowed; `frameDomains` is omitted, so nested frames stay blocked); `ui.domain` only when `McpHandlerDeps.widgetDomain` is set; the legacy mirror `openai/widgetCSP` (`connect_domains`, `resource_domains`, and `redirect_domains: [<our origin>]`, the only place the docs allow `redirect_domains`, needed for `openExternal`), `openai/widgetPrefersBorder`, `openai/widgetDomain`; and `openai/widgetDescription` (tells the model the card already shows the figures, so it does not recite them).
- **Tool `_meta`** on `analyze_property` and `what_if` (in `tools/list`): `ui.resourceUri` and `openai/outputTemplate`, both the same URI, plus `openai/toolInvocation/invoking` and `/invoked` status strings (docs: at most 64 characters). `ui.visibility` is left at its default (`["model","app"]`). `create_report` and `compare_properties` are not registered yet and will not get the template.
- **Result shape** is unchanged: `content[0].text` is the summary, `structuredContent` the card payload (what the widget renders), `_meta` the full analysis (hidden from the model). A client that ignores the template still gets everything.

## Runtime (what the widget does with the host)

Code: `apps/widget/src/client.ts`. The widget is a pure function of `structuredContent`: `renderCard(output)` in `render.ts` produces the HTML, the same function is used by the browser runtime, the tests and the preview pages.

| Need | Used first | Fallback |
|---|---|---|
| Get the tool output | `window.openai.toolOutput` (and the `openai:set_globals` event) | MCP Apps bridge: `ui/initialize` handshake, then `ui/notifications/tool-result` with `params.structuredContent` |
| Theme | `window.openai.theme` | `hostContext.theme` from `ui/initialize` and `ui/notifications/host-context-changed`; else `prefers-color-scheme` |
| "Change assumptions" | `window.openai.sendFollowUpMessage({ prompt })` | `ui/message` with `{ role: "user", content: { type: "text", text } }`; if neither exists, the button reveals a hint line telling the user to ask in the chat |
| "Open full report" | `window.openai.openExternal({ href })` | `ui/open-link` `{ url }` when the host advertises `openLinks`; else the plain anchor (`target="_blank" rel="noopener noreferrer"`) |
| Height | `ui/notifications/size-changed` (ResizeObserver) | `window.openai.notifyIntrinsicHeight(height)` if present |

The follow-up prompt names the analysis id so the assistant can call `what_if`, and asks which assumptions to change rather than guessing values. The address in it is flattened to one line of at most 100 characters because it is provider data that lands in the user's message box.

## Constraints we rely on

- The widget runs in a sandboxed iframe whose CSP is the one we publish in `_meta`. We publish an empty allow-list, so the document must not reference anything external: no CDN fonts or scripts, no images, no `fetch`. A test fails if the bundle contains a URL, `fetch(`, `XMLHttpRequest`, `WebSocket`, `localStorage` and similar.
- A plain link in the sandbox does not necessarily navigate; the docs route external links through `openExternal`, which follows `redirect_domains`. ChatGPT appends `?redirectUrl=...` to the link by default (we do not pass `redirectUrl: false`).
- `localStorage` is not used (the docs warn against it for core state). The card keeps no state; it re-renders from the tool output.
- Free text (address, notes, labels, usage period) is escaped everywhere; the report link is an `href` only when it is `http(s)`.
- Layout works from 280 px to 640 px with no horizontal overflow, light and dark.

## Build

`pnpm --filter @evalprop/widget build` bundles `src/client.ts` with esbuild (pinned, dev dependency only) into `src/bundle.generated.ts`, which is committed and imported by the server as `WIDGET_HTML`, so the server needs no build step or filesystem read at run time. A test rebuilds the bundle in memory and fails when the committed file is stale. `pnpm --filter @evalprop/widget preview` writes one page per fixture to `apps/widget/preview/` (git-ignored) with the output injected as `window.openai.toolOutput`.

## What we could not verify

All of this was verified only against the documentation and a simulated host (a test page that answers `ui/initialize`, sends `ui/notifications/tool-result` and records `ui/message` / `ui/open-link`). Nothing was run inside real ChatGPT, and no connector was registered there. Open points, each also tracked in STORIES Known issues:

- Whether ChatGPT currently injects `window.openai` for `ui://` / `text/html;profile=mcp-app` resources, or only speaks the bridge; the card handles both, so either should work, but the order of events (output arriving before or after the handshake) is untested. The `openai:set_globals` event is from older material; the current docs do not mention it.
- The `ui/message` content shape: the spec shows a single content object, the migration guide shows `content: [ ... ]` for the SDK helper. We follow the spec. The `window.openai.sendFollowUpMessage({ prompt })` signature is from the reference page.
- `notifyIntrinsicHeight`'s argument is not specified in the pages we read; the call is wrapped in try/catch and may be a no-op.
- `ui.domain`: the docs say hosted components need a dedicated origin (default `https://web-sandbox.oaiusercontent.com`) and submission requires one. We do not set it; S16 decides the origin and sets `McpHandlerDeps.widgetDomain`. Whether an empty CSP and no domain are accepted in development mode is untested.
- Whether `redirect_domains` is honoured when the same URL is also an `href`, and what the host shows on first open of an external link.
- The report link is still the placeholder `${baseUrl}/r/${analysisId}` (F33), which `GET /r/:token` does not resolve; the button works, the destination does not until S14 wires the real link.
- Fullscreen / picture-in-picture are not requested (`openai/ui.availableDisplayModes` is unset); the card is inline only.
