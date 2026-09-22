import { withAuth } from "next-auth/middleware";
import { isSignedIn, type SessionToken } from "./lib/github-session-token";

export default withAuth({
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    authorized: ({ token }) => isSignedIn(token as SessionToken | null),
  },
});

export const config = {
  matcher: [
    "/((?!auth|api/auth|api/version|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)",
  ],
};
