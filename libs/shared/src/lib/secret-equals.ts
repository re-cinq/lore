import { createHash, timingSafeEqual } from "node:crypto";

// Timing-safe token comparison. Here rather than beside the bearer helper because `outbound` needs it too, which made an adapter import from `transport`.

const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

/** Constant-time string compare; digests of equal size are compared, so neither the bytes nor the length of the secret leak and unequal lengths never throw. */
export function secretEquals(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}
