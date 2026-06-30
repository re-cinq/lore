import { execSync } from 'node:child_process';

let cachedRepo: string | null = null;

export function detectCurrentRepo(): string | null {
  if (cachedRepo) return cachedRepo;
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8', timeout: 5000 }).trim();
    // Parse SSH or HTTPS remote URLs
    // git@github.com:owner/repo.git → owner/repo
    // https://github.com/owner/repo.git → owner/repo
    const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) {
      cachedRepo = match[1];
      return cachedRepo;
    }
  } catch {}
  return null;
}

export function resetRepoCache(): void {
  cachedRepo = null;
}
