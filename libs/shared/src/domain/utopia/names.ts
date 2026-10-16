// The names the mirror gives entities. Utopia resolves an entity by its lower-cased name, so every builder that names the same thing must name it here.

export function fileName(repo: string, path: string): string {
  return `${repo}:${path}`;
}

export function statementName(
  repo: string,
  path: string,
  ordinal: number,
): string {
  return `${fileName(repo, path)}#s${String(ordinal).padStart(4, "0")}`;
}

export function testName(repo: string, path: string, title: string): string {
  return `${fileName(repo, path)}::${title}`;
}

export function blobUrl(repo: string, commit: string): string {
  return `https://github.com/${repo}/blob/${commit}`;
}
