import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { canonicalRepoRedirect } from "./lib/canonical-repo-path";
import { getRepo } from "./lib/api/repos";
import { isSignedIn, type SessionToken } from "./lib/github-session-token";

const REPO_PATH = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/;

/** The redirect target for a wrong-case /repos/{owner}/{repo}... URL, or null when the path isn't repo-scoped or already matches lore-api's canonical casing. */
async function repoCanonicalRedirect(
  req: NextRequestWithAuth,
): Promise<string | null> {
  const { pathname, search } = req.nextUrl;
  const match = REPO_PATH.exec(pathname);

  if (!match) {
    return null;
  }

  const result = await getRepo(`${match[1]}/${match[2]}`);
  const fullName = result.status === "ok" ? result.data.full_name : null;

  return canonicalRepoRedirect(pathname, search, fullName);
}

export default withAuth(
  async function middleware(req: NextRequestWithAuth) {
    const destination = await repoCanonicalRedirect(req);

    return destination
      ? NextResponse.redirect(new URL(destination, req.url), 307)
      : NextResponse.next();
  },
  {
    pages: {
      signIn: "/auth/signin",
    },
    callbacks: {
      authorized: ({ token }) => isSignedIn(token as SessionToken | null),
    },
  },
);

export const config = {
  matcher: [
    "/((?!auth|api/auth|api/version|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)",
  ],
};
