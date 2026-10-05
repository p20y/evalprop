import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { Bucket } from "@google-cloud/storage";

/** Where finished PDFs go. The path is the object name inside a private bucket: `reports/{reportId}.pdf`. */
export interface PdfStorage {
  put(path: string, bytes: Uint8Array): Promise<void>;
}

/** Object name for a report's PDF. One report id, one file; a re-render overwrites it. */
export const pdfPathFor = (reportId: string) => `reports/${reportId}.pdf`;

/** Private Cloud Storage bucket. The bucket has no public access; the server hands out short-lived signed URLs. */
export class GcsPdfStorage implements PdfStorage {
  readonly #bucket: Pick<Bucket, "file">;

  constructor(bucket: Pick<Bucket, "file">) {
    this.#bucket = bucket;
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    await this.#bucket.file(path).save(Buffer.from(bytes), { contentType: "application/pdf", resumable: false });
  }
}

/** For tests: keeps the bytes in memory. */
export class InMemoryPdfStorage implements PdfStorage {
  readonly files = new Map<string, Uint8Array>();

  async put(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes.slice());
  }
}

/** For the local script and dev: writes under a directory on disk. */
export class FilePdfStorage implements PdfStorage {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    const target = normalize(join(this.#dir, path));
    if (!target.startsWith(normalize(this.#dir))) throw new Error("path escapes the storage directory");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
