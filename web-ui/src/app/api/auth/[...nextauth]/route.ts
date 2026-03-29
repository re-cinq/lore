import NextAuth from "next-auth";
import GitHubProvider from "next-auth/providers/github";

const handler = NextAuth({
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
    async signIn({ profile }) {
      // Optional: restrict to specific GitHub org
      const allowedOrg = process.env.GITHUB_ALLOWED_ORG;
      if (!allowedOrg) return true;
      try {
        const res = await fetch(`https://api.github.com/orgs/${allowedOrg}/members/${(profile as any)?.login}`, {
          headers: { Authorization: `token ${process.env.GITHUB_OAUTH_CLIENT_SECRET}` },
        });
        return res.status === 204;
      } catch {
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
});

export { handler as GET, handler as POST };
