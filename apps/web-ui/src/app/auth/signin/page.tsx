import { signInStartHref } from "@/lib/return-path";
import SignInPanel from "../SignInPanel";

interface SignInProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignIn({ searchParams }: SignInProps) {
  const { next } = await searchParams;

  return (
    <SignInPanel
      message="Sign in to access the platform"
      action="Sign in with GitHub"
      href={signInStartHref(next ?? null)}
    />
  );
}
