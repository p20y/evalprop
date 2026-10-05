/**
 * Authentication seam for the MCP endpoint (ARCHITECTURE §5.5).
 *
 * The server never parses or trusts a token itself: it hands the bearer token to an `AuthProvider` and
 * gets back who the caller is, or a failure. Production wraps a managed OAuth vendor (S11); local dev
 * and tests use `FakeAuthProvider`. A real implementation MUST also check that the token was issued for
 * this server (audience / RFC 8707 resource), per the MCP authorization spec; that check lives behind
 * this interface, so the MCP layer needs no change when it arrives.
 */
export interface AuthenticatedUser {
  /** Stable account id. Becomes `ownerUid` on everything the user saves. */
  uid: string;
  email?: string;
  /** Optional hint of the caller's plan from the token; the plan itself is read from `users/{uid}` (S12). */
  planHint?: string;
}

export type AuthFailureReason = "invalid_token" | "expired_token";

export type AuthResult = ({ ok: true } & AuthenticatedUser) | { ok: false; reason: AuthFailureReason; message?: string };

export interface AuthProvider {
  /**
   * Verifies a bearer access token (the part after `Bearer `). Resolves to a failure for any token that is
   * not valid for this server; rejects only for infrastructure errors (the caller turns those into a 5xx,
   * never into a 401, so a flaky vendor does not make clients re-authenticate).
   */
  verifyAccessToken(token: string): Promise<AuthResult>;
}
