import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import {
  freshSessionToken,
  sessionTokenOf,
  type GitHubClient,
  type SessionToken,
} from "./github-session-token";

// The same OAuth app sign-in used: a GitHub App's refresh grant is made for it.
function githubClient(): GitHubClient {
  return {
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",
  };
}

function loginOf(profile: unknown): string {
  return (profile as { login?: string } | null | undefined)?.login ?? "unknown";
}

/** null means the request itself failed (network error or non-ok status) — distinct from an empty org list. */
async function fetchUserOrgs(
  accessToken: string | undefined,
): Promise<{ login?: string }[] | null> {
  try {
    const res = await fetch(`https://api.github.com/user/orgs`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return null;
    }
    const orgs = await res.json();

    return Array.isArray(orgs) ? orgs : [];
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",
      issuer: "https://github.com/login/oauth",
      authorization: {
        params: {
          scope: "read:user read:org repo",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      // Optional: restrict to specific GitHub org
      const allowedOrg = process.env.GITHUB_ALLOWED_ORG;

      if (!allowedOrg) {
        return true;
      }
      const login = loginOf(profile);
      const orgs = await fetchUserOrgs(account?.access_token);

      if (orgs === null) {
        console.error(`[auth] GitHub /user/orgs failed for ${login}`);

        return false;
      }
      const isMember = orgs.some((o) => o.login === allowedOrg);

      if (!isMember) {
        console.error(
          `[auth] ${login} not in org "${allowedOrg}". Visible orgs: [${orgs.map((o) => o.login).join(", ")}]. User may need to grant OAuth app access to the org.`,
        );
      }

      return isMember;
    },
    async jwt({ token, account, profile }) {
      // The login is who a person is in a plan; the display name can change or be empty.
      if (profile) {
        token.login = loginOf(profile);
      }
      const github = account
        ? sessionTokenOf(account)
        : await freshSessionToken(token as SessionToken, githubClient());

      // Every field is written, so a refused refresh leaves no stale token behind.
      return {
        ...token,
        accessToken: github.accessToken,
        refreshToken: github.refreshToken,
        accessTokenExpires: github.accessTokenExpires,
        error: github.error,
      };
    },
    async session({ session, token }) {
      Object.assign(session, {
        accessToken: token.accessToken,
        login: token.login,
      });

      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};
