import { createHash, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

/**
 * Service-to-service authentication for `POST /internal/render`. The worker is not a public service: its only
 * caller is Cloud Tasks (cloud) or the local dev server / a developer (local).
 */
export interface InternalAuthVerifier {
  /** True only for a valid credential. `authorization` is the raw `Authorization` header, if any. Never throws. */
  verify(authorization: string | undefined): Promise<boolean>;
}

const bearer = (header: string | undefined): string | null => {
  const m = /^Bearer ([^\s]+)$/i.exec(header ?? "");
  return m ? m[1]! : null;
};

/** Local development: one shared secret in `INTERNAL_AUTH_TOKEN`, compared in constant time. */
export class SharedSecretVerifier implements InternalAuthVerifier {
  readonly #digest: Buffer;

  constructor(secret: string) {
    if (secret.length < 16) throw new Error("INTERNAL_AUTH_TOKEN must be at least 16 characters");
    // Hash both sides so timingSafeEqual always compares equal-length buffers.
    this.#digest = createHash("sha256").update(secret).digest();
  }

  async verify(authorization: string | undefined): Promise<boolean> {
    const presented = bearer(authorization);
    if (presented === null) return false;
    return timingSafeEqual(createHash("sha256").update(presented).digest(), this.#digest);
  }
}

/** The one call we need from Google's token verifier; tests pass a fake. */
export interface IdTokenVerifier {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): { email?: string | undefined; email_verified?: boolean | undefined } | undefined }>;
}

/**
 * Cloud: the caller sends a Google-signed OIDC ID token (Cloud Tasks attaches one for the invoker service
 * account). We check the signature and expiry (via Google's public certificates), that the audience is this
 * service, and that the token belongs to one of the allowed service accounts. Cloud Run's own IAM check
 * (`roles/run.invoker`, no unauthenticated access) is the first gate; this is the second.
 */
export class GoogleOidcVerifier implements InternalAuthVerifier {
  readonly #client: IdTokenVerifier;
  readonly #audience: string;
  readonly #allowedEmails: Set<string>;

  constructor(options: { audience: string; allowedServiceAccounts: string[]; client?: IdTokenVerifier }) {
    if (options.allowedServiceAccounts.length === 0) throw new Error("at least one allowed service account is required");
    this.#audience = options.audience;
    this.#allowedEmails = new Set(options.allowedServiceAccounts.map((e) => e.toLowerCase()));
    this.#client = options.client ?? new OAuth2Client();
  }

  async verify(authorization: string | undefined): Promise<boolean> {
    const idToken = bearer(authorization);
    if (idToken === null) return false;
    try {
      const ticket = await this.#client.verifyIdToken({ idToken, audience: this.#audience });
      const payload = ticket.getPayload();
      return payload?.email_verified === true && typeof payload.email === "string" && this.#allowedEmails.has(payload.email.toLowerCase());
    } catch {
      return false;
    }
  }
}

export interface AuthEnv {
  INTERNAL_AUTH_TOKEN?: string | undefined;
  OIDC_AUDIENCE?: string | undefined;
  OIDC_INVOKER_EMAILS?: string | undefined;
}

/**
 * Chooses the verifier from the environment. With nothing configured it throws, so the service never starts
 * open. OIDC wins if both are set (a shared secret must not weaken a cloud deployment).
 */
export function verifierFromEnv(env: AuthEnv = process.env): InternalAuthVerifier {
  if (env.OIDC_AUDIENCE && env.OIDC_INVOKER_EMAILS) {
    const emails = env.OIDC_INVOKER_EMAILS.split(",").map((e) => e.trim()).filter(Boolean);
    return new GoogleOidcVerifier({ audience: env.OIDC_AUDIENCE, allowedServiceAccounts: emails });
  }
  if (env.INTERNAL_AUTH_TOKEN) return new SharedSecretVerifier(env.INTERNAL_AUTH_TOKEN);
  throw new Error("no service authentication configured: set OIDC_AUDIENCE and OIDC_INVOKER_EMAILS (cloud) or INTERNAL_AUTH_TOKEN (local)");
}
