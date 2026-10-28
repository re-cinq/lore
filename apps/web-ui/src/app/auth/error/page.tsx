import { signInStartHref } from "@/lib/return-path";
import { failureOf, signInFailureMessage } from "@/lib/sign-in-callback";
import SignInPanel from "../SignInPanel";

interface ErrorPageProps {
  searchParams: Promise<{ reason?: string; next?: string }>;
}

export default async function SignInError({ searchParams }: ErrorPageProps) {
  const { reason, next } = await searchParams;

  return (
    <SignInPanel
      message={signInFailureMessage(failureOf(reason ?? ""))}
      action="Try again"
      href={signInStartHref(next ?? null)}
    />
  );
}
