/**
 * Whether a nav link is active for the current path. The `rootHref` (e.g. `/`
 * for the sidebar, the repo base for the tab group) matches only on its exact
 * path; every other link also matches its sub-routes, on a `/` boundary so
 * `/assembly-runs` does not light up on `/assembly-liness`.
 */
export function isNavActive(
  pathname: string,
  href: string,
  rootHref: string,
): boolean {
  if (href === rootHref) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
