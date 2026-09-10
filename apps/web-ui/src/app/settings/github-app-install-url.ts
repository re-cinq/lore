/** Where an admin installs the GitHub App, by its public slug, on another account (specs/4-ux-repo-onboarding FR-8). */
export function githubAppInstallUrl(slug: string): string {
  return `https://github.com/apps/${slug}/installations/new`;
}
