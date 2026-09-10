import { createHmac } from "node:crypto";
import { secretEquals } from "../../lib/secret-equals.js";

/** What a run credential vouches for: which station run is asking, for which repo, until when. */
export interface RunCredentialClaims {
  stationRunId: string;
  repo: string;
  expiresAt: string;
}

export type RunCredentialVerdict =
  | { ok: true; claims: RunCredentialClaims }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

const VERSION = "v1";

/** `v1.<base64url claims>.<hex HMAC-SHA256 of "v1.<payload>">` — the signature covers the version too, so a future format cannot be replayed as this one. */
export function signRunCredential(
  claims: RunCredentialClaims,
  key: string,
): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");

  return `${VERSION}.${payload}.${mac(`${VERSION}.${payload}`, key)}`;
}

export function verifyRunCredential(
  credential: string,
  key: string,
  now: Date,
): RunCredentialVerdict {
  const [version, payload, signature] = credential.split(".");

  if (version !== VERSION || !payload || !signature) {
    return { ok: false, reason: "malformed" };
  }

  if (!secretEquals(signature, mac(`${version}.${payload}`, key))) {
    return { ok: false, reason: "bad-signature" };
  }
  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString(),
  ) as RunCredentialClaims;

  if (now.getTime() >= Date.parse(claims.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims };
}

function mac(signed: string, key: string): string {
  return createHmac("sha256", key).update(signed).digest("hex");
}
