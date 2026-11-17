import { DEFAULT_GITHUB_HOST, githubUrls } from "@/lib/github-host";

/** Where an admin installs the GitHub App, by its public slug, on another account (specs/4-ux-repo-onboarding FR-8); null while no slug is configured, so the page offers no link rather than a broken one. */
export function githubAppInstallUrl(
  slug: string | undefined,
  host: string = DEFAULT_GITHUB_HOST,
): string | null {
  return slug ? `${githubUrls(host).web}/apps/${slug}/installations/new` : null;
}
