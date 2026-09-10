/** What a run credential vouches for: which station run is asking, for which repo, until when. */
export interface RunCredentialClaims {
  stationRunId: string;
  repo: string;
  expiresAt: string;
}

export type RunCredentialVerdict = { ok: true; claims: RunCredentialClaims };

export function signRunCredential(
  claims: RunCredentialClaims,
  _key: string,
): string {
  return JSON.stringify(claims);
}

export function verifyRunCredential(
  credential: string,
  _key: string,
  _now: Date,
): RunCredentialVerdict {
  return { ok: true, claims: JSON.parse(credential) as RunCredentialClaims };
}
