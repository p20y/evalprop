import { renderUnknown } from "./render.ts";

/**
 * Browser runtime, bundled into the widget HTML. It makes no network request: it only listens for what the
 * host delivers and talks back to the host through `window.openai` or the MCP Apps `postMessage` bridge.
 *
 * Inputs, first match wins, later updates re-render:
 *  1. `window.openai.toolOutput` (ChatGPT's compatibility runtime) and its `openai:set_globals` event.
 *  2. The MCP Apps bridge: `ui/initialize` handshake, then `ui/notifications/tool-result` carrying
 *     `structuredContent` (OpenAI's current docs call this the portable, preferred path).
 * Outputs: "Change assumptions" posts a user message (`window.openai.sendFollowUpMessage({ prompt })`, else
 * `ui/message`, else it reveals a hint); the report link opens through `openExternal` / `ui/open-link` when
 * the host offers them, else as a plain anchor. Sizing is reported with `ui/notifications/size-changed`.
 */

interface OpenAiGlobals {
  toolOutput?: unknown;
  theme?: string;
  sendFollowUpMessage?: (arg: { prompt: string }) => unknown;
  openExternal?: (arg: { href: string }) => unknown;
  notifyIntrinsicHeight?: (height: number) => unknown;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
}

const PROTOCOL_VERSION = "2026-01-26";

const rootEl = document.getElementById("root");
const openai = (): OpenAiGlobals | undefined => (window as unknown as { openai?: OpenAiGlobals }).openai;
const inFrame = window.parent !== window;

let bridgeReady = false;
let hostCanOpenLinks = false;
let nextId = 1;
const pending = new Map<number, (message: JsonRpcMessage) => void>();

function post(message: JsonRpcMessage): void {
  if (inFrame) window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
}

function request(method: string, params: Record<string, unknown>): Promise<JsonRpcMessage> {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    post({ id, method, params });
  });
}

function applyTheme(theme: unknown): void {
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
}

function show(raw: unknown): void {
  if (rootEl === null) return;
  rootEl.innerHTML = renderUnknown(raw);
  reportSize();
}

let lastHeight = 0;
function reportSize(): void {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height === lastHeight || height === 0) return;
  lastHeight = height;
  if (bridgeReady) post({ method: "ui/notifications/size-changed", params: { width: Math.ceil(window.innerWidth), height } });
  try {
    openai()?.notifyIntrinsicHeight?.(height);
  } catch {
    // Optional host API; ignore.
  }
}

function showHint(): void {
  const hint = document.querySelector<HTMLElement>("[data-hint]");
  if (hint !== null) hint.hidden = false;
  reportSize();
}

async function sendPrompt(prompt: string): Promise<void> {
  const o = openai();
  if (typeof o?.sendFollowUpMessage === "function") {
    await o.sendFollowUpMessage({ prompt });
    return;
  }
  if (bridgeReady) {
    const reply = await request("ui/message", { role: "user", content: { type: "text", text: prompt } });
    if (reply.error === undefined) return;
  }
  showHint();
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
  if (target === null) return;
  const action = target.getAttribute("data-action");
  if (action === "change-assumptions") {
    event.preventDefault();
    sendPrompt(target.getAttribute("data-prompt") ?? "").catch(showHint);
  } else if (action === "open-report" && target instanceof HTMLAnchorElement) {
    const o = openai();
    if (typeof o?.openExternal === "function") {
      event.preventDefault();
      Promise.resolve(o.openExternal({ href: target.href })).catch(() => {});
    } else if (hostCanOpenLinks) {
      event.preventDefault();
      request("ui/open-link", { url: target.href }).catch(() => {});
    }
  }
});

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent) return;
  const message = event.data as JsonRpcMessage | null;
  if (message === null || typeof message !== "object" || message.jsonrpc !== "2.0") return;
  if (typeof message.id === "number" && message.method === undefined) {
    const resolve = pending.get(message.id);
    if (resolve !== undefined) {
      pending.delete(message.id);
      resolve(message);
    }
    return;
  }
  if (message.method === "ui/notifications/tool-result") {
    show(message.params?.["structuredContent"]);
  } else if (message.method === "ui/notifications/host-context-changed") {
    applyTheme(message.params?.["theme"]);
  }
});

window.addEventListener("openai:set_globals", (event) => {
  const globals = (event as CustomEvent<{ globals?: OpenAiGlobals }>).detail?.globals;
  if (globals === undefined) return;
  if ("theme" in globals) applyTheme(globals.theme);
  if ("toolOutput" in globals && globals.toolOutput !== null && globals.toolOutput !== undefined) show(globals.toolOutput);
});

applyTheme(openai()?.theme);
const initial = openai()?.toolOutput;
if (initial !== undefined && initial !== null) show(initial);

if (inFrame) {
  request("ui/initialize", {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: { name: "evalprop-deal-card", version: "0.1.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  })
    .then((reply) => {
      const result = reply.result;
      if (result === undefined) return;
      bridgeReady = true;
      const hostContext = result["hostContext"] as { theme?: unknown } | undefined;
      applyTheme(hostContext?.theme);
      const caps = result["hostCapabilities"] as { openLinks?: unknown } | undefined;
      hostCanOpenLinks = caps?.openLinks !== undefined;
      post({ method: "ui/notifications/initialized", params: {} });
      lastHeight = 0;
      reportSize();
    })
    .catch(() => {});
}

if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.documentElement);
