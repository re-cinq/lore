/**
 * GitHub's webhook HMAC, verified in constant time.
 *
 * Shared because two deployables verify the same signature during the
 * event-router transition: the router's `POST /api/events` and the Floor's
 * `POST /api/webhook/github`, which stands until every repo's webhook URL is
 * re-pointed (ADR-044 names that as the deletion condition). A verifier that
 * disagrees with itself across those two is a webhook that lands on one and is
 * refused by the other, which is the failure the transition exists to avoid.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(
  secret: string,
  signature: string,
  body: string,
): boolean {
  const expected =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);

  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first — a signature's length is not the secret; the digest's bytes are.
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}
