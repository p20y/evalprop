import { Hono } from "hono";
import { ENGINE_VERSION } from "@evalprop/engine";

export function createApp(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, engineVersion: ENGINE_VERSION }));
  return app;
}
