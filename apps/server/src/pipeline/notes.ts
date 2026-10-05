import type { DataNote } from "@evalprop/shared";
import type { ProviderFailure } from "@evalprop/data";

export const warn = (section: string, message: string): DataNote => ({ section, severity: "warning", message });
export const info = (section: string, message: string): DataNote => ({ section, severity: "info", message });

/**
 * Plain-language reason for a failed provider call. Never includes the provider's own message: it may
 * echo the request (an address, listing text), and `dataNotes` are stored and shown.
 */
export function failureReason(f: ProviderFailure): string {
  switch (f.code) {
    case "TIMEOUT":
      return "timed out";
    case "ERROR":
      return "failed";
    case "RATE_LIMITED":
      return "was rate limited";
    case "NOT_FOUND":
      return "returned no data for this location";
    case "UNAVAILABLE":
      return "was unavailable";
    case "AMBIGUOUS":
      return "matched more than one place";
  }
}
