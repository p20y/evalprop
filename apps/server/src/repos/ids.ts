import { randomBytes } from "node:crypto";

/**
 * Random, unguessable ID with a readable prefix (ARCHITECTURE §6.2): 144 bits from the OS CSPRNG,
 * base64url so it is safe in URLs and as a Firestore document ID (no "/").
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}
