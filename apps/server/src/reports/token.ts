import { createHash, randomBytes } from "node:crypto";

/** 128 bits of randomness as 22 base64url characters. */
export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

/** A random, unguessable id for a record (not a credential). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** The only form of a token that is ever stored: lower-case hex SHA-256. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** True for strings shaped like a token we issue (22 base64url characters). Cheap rejection before any lookup. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(token);
}
