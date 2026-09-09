import { createHash, randomBytes } from "node:crypto";

/** Per-agent bearer token minting: plaintext in register response only, SHA-256 in DB. */

export interface MintedAgentToken {
  token: string;
  tokenHash: string;
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintAgentToken(
  random: () => string = () => randomBytes(32).toString("hex"),
): MintedAgentToken {
  const token = `lca_${random()}`;

  return { token, tokenHash: hashAgentToken(token) };
}
