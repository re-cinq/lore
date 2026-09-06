// GitHub's webhook HMAC, verified in constant time — shared by the router's `POST /api/events` and the Floor's `POST /api/webhook/github` during the event-router transition (ADR-044) so the two never disagree on a signature.

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

  // `timingSafeEqual` throws on a length mismatch, so lengths are compared first.
  return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
}
