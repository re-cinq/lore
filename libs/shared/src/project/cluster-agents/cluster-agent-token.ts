import { createHash, randomBytes } from "node:crypto";

/**
 * Per-agent bearer token minting. The plaintext exists once — in the register
 * response — and only its SHA-256 lands in `pipeline.cluster_agents`, the
 * same discipline `pipeline.api_tokens` follows.
 */

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
