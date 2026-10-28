const HOME = "/";

/** The page to send a person back to after signing in: the one they asked for when it is a path on this site, the home page otherwise. A redirect target that came from a query string must never leave the site or loop through the sign-in. */
export function returnPathOf(requested: string | null): string {
  return isSitePath(requested) ? requested : HOME;
}

/** The link that starts the sign-in, carrying the page to come back to. */
export function signInStartHref(requested: string | null): string {
  const path = returnPathOf(requested);

  return path === HOME
    ? "/auth/start"
    : `/auth/start?next=${encodeURIComponent(path)}`;
}

function isSitePath(requested: string | null): requested is string {
  return (
    requested !== null &&
    /^\/(?![/\\])[^\r\n\\]*$/.test(requested) &&
    !/^\/auth(?:[/?#]|$)/.test(requested)
  );
}
