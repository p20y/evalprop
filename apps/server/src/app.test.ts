import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "./app.ts";

test("GET /health returns ok and the engine version", async () => {
  const res = await createApp().request("/health");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; engineVersion: string };
  assert.equal(body.ok, true);
  assert.equal(typeof body.engineVersion, "string");
});
