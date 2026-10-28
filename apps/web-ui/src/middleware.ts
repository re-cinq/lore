import { NextResponse, type NextRequest } from "next/server";
import { canonicalRepoRedirect } from "./lib/canonical-repo-path";
import { getRepo } from "./lib/api/repos";
import { requestOrigin } from "./lib/request-origin";
import { SESSION_COOKIE } from "./lib/session-cookie-options";

const REPO_PATH = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/;

// A request without a session cookie goes to sign in; the cookie expires with the token it holds, and lore-api judges the token itself on every call.
export default async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE);
  const token = cookie?.value;

  if (!token) {
    return NextResponse.redirect(
      new URL("/auth/signin", requestOrigin(req.headers)),
    );
  }
  const destination = await repoCanonicalRedirect(req, token);

  return destination
    ? NextResponse.redirect(new URL(destination, req.url), 307)
    : NextResponse.next();
}

/** The redirect target for a wrong-case /repos/{owner}/{repo}... URL, or null when the path isn't repo-scoped or already matches lore-api's canonical casing. */
async function repoCanonicalRedirect(
  req: NextRequest,
  token: string,
): Promise<string | null> {
  const { pathname, search } = req.nextUrl;
  const match = REPO_PATH.exec(pathname);

  if (!match) {
    return null;
  }

  const result = await getRepo(`${match[1]}/${match[2]}`, { token });
  const fullName = result.status === "ok" ? result.data.full_name : null;

  return canonicalRepoRedirect(pathname, search, fullName);
}

export const config = {
  matcher: [
    "/((?!auth|api/auth|api/version|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)",
  ],
};
