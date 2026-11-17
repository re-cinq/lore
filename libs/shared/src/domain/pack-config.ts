export interface PackConfig {
  repo: string;
  /** Undefined reads the repository's default branch. */
  ref: string | undefined;
}

export function packConfig(
  env: Record<string, string | undefined>,
): PackConfig | null {
  return env.LORE_PACK_REPO
    ? { repo: env.LORE_PACK_REPO, ref: env.LORE_PACK_REF || undefined }
    : null;
}
