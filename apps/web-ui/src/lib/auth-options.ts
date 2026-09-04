import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

function loginOf(profile: unknown): string {
  return (profile as { login?: string })?.login ?? "unknown";
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
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }

      return token;
    },
    async session({ session, token }) {
      (session as { accessToken?: unknown }).accessToken = token.accessToken;

      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};
