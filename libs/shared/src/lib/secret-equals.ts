import { timingSafeEqual } from "node:crypto";

// Timing-safe token comparison. Here rather than beside the bearer helper because `outbound` needs it too, which made an adapter import from `transport`.

/** Constant-time string compare. */
export function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // timingSafeEqual throws on length mismatch; token length is not secret, only bytes.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
