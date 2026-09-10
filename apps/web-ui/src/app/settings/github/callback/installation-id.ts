/** The query string GitHub redirects an admin back with after installing the App: `installation_id` and `setup_action`, as a Next.js page receives it. */
export type SetupRedirectParams = Record<string, string | string[] | undefined>;

/** The installation id GitHub named in its setup redirect (specs/4-ux-repo-onboarding FR-8). */
export function installationIdFrom(params: SetupRedirectParams): number {
  return Number(params.installation_id);
}
