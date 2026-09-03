/** Nav link is active for current path; rootHref matches exact path, others match sub-routes on / boundary. */
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
