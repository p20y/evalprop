import type { AuthProvider, AuthResult } from "./interface.ts";

/** Prefix of an accepted test token: `test-token-<uid>`, for example `test-token-dev`. */
export const FAKE_TOKEN_PREFIX = "test-token-";

const UID = /^[A-Za-z0-9_-]{1,64}$/;

/** The bearer token that signs in as `uid` with the fake provider. */
export const fakeTokenFor = (uid: string): string => `${FAKE_TOKEN_PREFIX}${uid}`;

/**
 * Local-dev and test auth. Accepts exactly `test-token-<uid>` where `<uid>` is 1 to 64 letters, digits,
 * `_` or `-`, and resolves to `{ uid, email: "<uid>@example.test" }`. Everything else is rejected, and
 * `test-token-expired` simulates an expired token so the expiry path can be exercised.
 * Never wire this into a deployed environment.
 */
export class FakeAuthProvider implements AuthProvider {
  async verifyAccessToken(token: string): Promise<AuthResult> {
    if (!token.startsWith(FAKE_TOKEN_PREFIX)) return { ok: false, reason: "invalid_token" };
    const uid = token.slice(FAKE_TOKEN_PREFIX.length);
    if (!UID.test(uid)) return { ok: false, reason: "invalid_token" };
    if (uid === "expired") return { ok: false, reason: "expired_token", message: "The access token expired." };
    return { ok: true, uid, email: `${uid}@example.test` };
  }
}
