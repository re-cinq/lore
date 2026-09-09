/** What a repo's onboarding context is made of, stated once so the Floor and lore-api cannot answer it differently; each fetches it through its own mechanism. */

export interface RepoContext {
  tree: string[];
  files: Record<string, string>;
  samples: Record<string, string>;
}

/** Files read whole, because they say what the repo is before any source is sampled. */
export const KEY_FILES = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "package.json",
  "go.mod",
  "Cargo.toml",
  "requirements.txt",
  "Dockerfile",
  "docker-compose.yml",
  "pom.xml",
  "Makefile",
  "tsconfig.json",
  "pyproject.toml",
];

/** Where source is sampled from, in preference order. */
export const SAMPLE_DIRS = ["src", "lib", "cmd", "internal", "app", "pkg"];
