import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FilePdfStorage, GcsPdfStorage, InMemoryPdfStorage } from "./storage.ts";

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

test("GcsPdfStorage saves the bytes as application/pdf at the given object name", async () => {
  const saved: { name: string; data: Buffer; options: unknown }[] = [];
  const bucket = { file: (name: string) => ({ save: async (data: Buffer, options: unknown) => void saved.push({ name, data, options }) }) };
  await new GcsPdfStorage(bucket as never).put("reports/rpt_1.pdf", bytes);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.name, "reports/rpt_1.pdf");
  assert.deepEqual([...saved[0]!.data], [...bytes]);
  assert.deepEqual(saved[0]!.options, { contentType: "application/pdf", resumable: false });
});

test("InMemoryPdfStorage keeps a copy", async () => {
  const s = new InMemoryPdfStorage();
  const b = bytes.slice();
  await s.put("reports/a.pdf", b);
  b[0] = 0;
  assert.equal(s.files.get("reports/a.pdf")![0], 0x25);
});

test("FilePdfStorage writes under its directory and refuses paths that escape it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pdfstore-"));
  try {
    const s = new FilePdfStorage(dir);
    await s.put("reports/rpt_1.pdf", bytes);
    assert.deepEqual([...(await readFile(join(dir, "reports/rpt_1.pdf")))], [...bytes]);
    await assert.rejects(s.put("../escape.pdf", bytes), /escapes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
