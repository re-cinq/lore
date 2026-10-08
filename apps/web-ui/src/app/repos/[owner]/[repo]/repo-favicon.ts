export interface RepoFavicon {
  initials: string;
  backgroundColor: string;
}

export function repoFavicon(owner: string, repo: string): RepoFavicon {
  const initials = `${owner.charAt(0)}${repo.charAt(0)}`.toUpperCase();
  const color = (hashRepository(owner, repo) & 0x00ffffff)
    .toString(16)
    .padStart(6, "0")
    .toUpperCase();

  return { initials, backgroundColor: `#${color}` };
}

function hashRepository(owner: string, repo: string): number {
  let hash = 0;

  for (const character of `${owner}/${repo}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}
