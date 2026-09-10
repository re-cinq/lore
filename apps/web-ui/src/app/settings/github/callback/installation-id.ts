/** The query string GitHub redirects an admin back with after installing the App: `installation_id` and `setup_action`, as a Next.js page receives it. */
export type SetupRedirectParams = Record<string, string | string[] | undefined>;

/** The installation id GitHub named in its setup redirect (specs/4-ux-repo-onboarding FR-8), or null when it named none — missing, repeated, or anything but digits — so the callback never posts a guess to lore-api. */
export function installationIdFrom(params: SetupRedirectParams): number | null {
  const raw = params.installation_id;

  return typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
}
