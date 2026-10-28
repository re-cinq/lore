import { failureOf, signInFailureMessage } from "@/lib/sign-in-callback";
import SignInPanel from "../SignInPanel";

interface ErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function SignInError({ searchParams }: ErrorPageProps) {
  const { reason } = await searchParams;

  return (
    <SignInPanel
      message={signInFailureMessage(failureOf(reason ?? ""))}
      action="Try again"
      href="/auth/start"
    />
  );
}
