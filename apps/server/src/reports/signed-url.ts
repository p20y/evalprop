/**
 * Short-lived links to stored PDFs (ARCHITECTURE section 6.3: no public objects, signed URLs only after the
 * report token has been verified). The route (`routes/report.ts`) is the only caller.
 */

/** How long a signed PDF link works. Short: the link is only ever used straight after the redirect. */
export const DEFAULT_PDF_URL_TTL_SECONDS = 600;

export interface SignedUrlProvider {
  /** A URL that downloads the object at `objectPath` until `expiresInSeconds` have passed. */
  sign(objectPath: string, options: { expiresInSeconds: number; downloadFilename?: string }): Promise<string>;
}

/** The slice of a Cloud Storage bucket this needs. The real `Bucket` satisfies it; tests pass a fake. */
export interface SignableBucket {
  file(path: string): {
    getSignedUrl(config: {
      version: "v4";
      action: "read";
      expires: number;
      responseType?: string;
      responseDisposition?: string;
    }): Promise<[string]>;
  };
}

/**
 * Cloud Storage V4 signed URLs. On Cloud Run the runtime service account signs through the IAM Credentials API,
 * so it needs `roles/iam.serviceAccountTokenCreator` on itself (docs/SETUP.md). The bucket is private; the URL
 * is the only way in.
 */
export class GcsSignedUrlProvider implements SignedUrlProvider {
  readonly #bucket: SignableBucket;
  readonly #now: () => number;

  constructor(bucket: SignableBucket, now: () => number = Date.now) {
    this.#bucket = bucket;
    this.#now = now;
  }

  async sign(objectPath: string, options: { expiresInSeconds: number; downloadFilename?: string }): Promise<string> {
    // Quotes and control characters would break the header; keep a conservative file name.
    const name = (options.downloadFilename ?? "evalprop-report.pdf").replace(/[^A-Za-z0-9._-]/g, "_");
    const [url] = await this.#bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: this.#now() + options.expiresInSeconds * 1000,
      responseType: "application/pdf",
      responseDisposition: `inline; filename="${name}"`,
    });
    return url;
  }
}

/** For tests and local development: a recognisable fake URL that records what it was asked to sign. */
export class FakeSignedUrlProvider implements SignedUrlProvider {
  readonly calls: { objectPath: string; expiresInSeconds: number; expiresAtMs: number }[] = [];
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async sign(objectPath: string, options: { expiresInSeconds: number }): Promise<string> {
    const expiresAtMs = this.#now() + options.expiresInSeconds * 1000;
    this.calls.push({ objectPath, expiresInSeconds: options.expiresInSeconds, expiresAtMs });
    return `https://storage.example/signed/${encodeURIComponent(objectPath)}?expires=${expiresAtMs}`;
  }
}
