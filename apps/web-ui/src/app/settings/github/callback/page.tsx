export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { recordGithubInstallation } from "@/lib/api/github-installations";
import {
  installationIdFrom,
  type SetupRedirectParams,
} from "./installation-id";
import { callbackOutcome } from "./callback-outcome";

/** The GitHub App's Setup URL (specs/4-ux-repo-onboarding FR-8): GitHub sends an admin here after they install the App. It records the installation GitHub named, then returns to settings, or says why it could not. */
export default async function GithubCallbackPage(props: {
  searchParams: Promise<SetupRedirectParams>;
}) {
  const installationId = installationIdFrom(await props.searchParams);

  if (installationId === null) {
    return (
      <CallbackMessage text="GitHub did not say which installation to record, so nothing was recorded." />
    );
  }
  const outcome = callbackOutcome(
    await recordGithubInstallation(installationId),
  );

  if ("redirectTo" in outcome) {
    redirect(outcome.redirectTo);
  }

  return <CallbackMessage text={outcome.error} />;
}

function CallbackMessage({ text }: { text: string }) {
  return (
    <div>
      <h1>Connect GitHub</h1>
      <p>{text}</p>
      <Link href="/settings">Back to settings</Link>
    </div>
  );
}
