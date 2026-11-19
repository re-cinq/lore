import { NextResponse, type NextRequest } from "next/server";
import { canonicalRepoRedirect } from "./lib/canonical-repo-path";
import { getMe } from "./lib/api/auth";
import { getRepo } from "./lib/api/repos";
import type { ApiResult } from "./lib/api/result";
import { requestOrigin } from "./lib/request-origin";
import { SESSION_COOKIE } from "./lib/session-cookie-options";

const REPO_PATH = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/;

// A request goes on only with a session lore-api knows: a missing cookie, or one whose token lore-api refuses, goes to sign in. Pages and routes that read GitHub themselves never ask lore-api, so the cookie's presence alone must not let a request through.
export default async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE);
  const token = cookie?.value;

  if (!token) {
    return toSignIn(req);
  }
  const session = await getMe({ token, timeoutMs: SESSION_DEADLINE_MS });

  if (session.status !== "ok") {
    return sessionRefused(req, session);
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

/** A hung lore-api must not hold every request of the UI. */
const SESSION_DEADLINE_MS = 10_000;

function toSignIn(req: NextRequest): NextResponse {
  return NextResponse.redirect(
    new URL(signInPath(req), requestOrigin(req.headers)),
  );
}

/** lore-api said no (401, 403): the cookie is dropped and the person signs in again. Anything else means lore-api could not be asked, and nobody is let through on an unchecked cookie. */
function sessionRefused(
  req: NextRequest,
  session: Exclude<ApiResult<unknown>, { status: "ok" }>,
): NextResponse {
  const code = session.status === "error" ? session.code : undefined;

  if (code === 401 || code === 403) {
    const response = toSignIn(req);

    response.cookies.delete(SESSION_COOKIE);

    return response;
  }

  return new NextResponse(
    "Lore cannot check your session right now. Try again in a moment.",
    { status: 503 },
  );
}

/** The sign-in page, told which page the person asked for. */
function signInPath(req: NextRequest): string {
  const { pathname, search } = req.nextUrl;

  return `/auth/signin?next=${encodeURIComponent(pathname + search)}`;
}

export const config = {
  matcher: [
    // Sign-in, the session and version probes, Next's own assets and the named public files. Nothing is let through for the way its path ends: a repository page may end in ".png".
    "/((?!auth(?:/|$)|api/auth(?:/|$)|api/version$|_next/static/|_next/image(?:/|$)|favicon\\.ico$|robots\\.txt$|icon\\.svg$|lore-logo(?:-dark)?\\.svg$).*)",
  ],
};
