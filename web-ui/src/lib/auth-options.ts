import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",
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
      if (!allowedOrg) return true;
      const login = (profile as any)?.login ?? "unknown";
      try {
        const res = await fetch(`https://api.github.com/user/orgs`, {
          headers: { Authorization: `Bearer ${account?.access_token}` },
        });
        if (!res.ok) {
          console.error(`[auth] GitHub /user/orgs failed for ${login}: ${res.status} ${res.statusText}`);
          return false;
        }
        const orgs = await res.json();
        const isMember = Array.isArray(orgs) && orgs.some((o: any) => o.login === allowedOrg);
        if (!isMember) {
          const orgLogins = Array.isArray(orgs) ? orgs.map((o: any) => o.login) : [];
          console.error(`[auth] ${login} not in org "${allowedOrg}". Visible orgs: [${orgLogins.join(", ")}]. User may need to grant OAuth app access to the org.`);
        }
        return isMember;
      } catch (err) {
        console.error(`[auth] Org check failed for ${login}:`, err);
        return false;
      }
    },
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};
