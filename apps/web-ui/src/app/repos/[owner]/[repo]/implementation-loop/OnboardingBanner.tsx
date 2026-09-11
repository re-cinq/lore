import Link from "next/link";
import { useTransition } from "react";
import { Alert } from "@/components/Alert";
import type { ImplementationLoop } from "@/lib/api/backlog";

interface OnboardingBannerProps {
  loop: ImplementationLoop;
  retry: () => Promise<void>;
}

/** Why an enabled loop picks nothing. The loop only works repos whose onboarding PR has merged, and before this banner the page showed such a repo as enabled with its tickets queued. */
export default function OnboardingBanner({
  loop,
  retry,
}: OnboardingBannerProps) {
  if (!loop.enabled || loop.onboarding.merged) {
    return null;
  }

  return (
    <Alert>
      The loop is on but won&apos;t pick tickets: Lore only works repos whose
      onboarding PR has merged.{" "}
      <OnboardingNextStep onboarding={loop.onboarding} retry={retry} />
    </Alert>
  );
}

interface OnboardingStepProps {
  onboarding: ImplementationLoop["onboarding"];
  retry: () => Promise<void>;
}

/** The one action that moves onboarding forward: merge the PR it already opened, follow the run already under way, or queue it. Retrying while a PR waits or a run is in flight would only be refused by the onboard guard. */
function OnboardingNextStep({ onboarding, retry }: OnboardingStepProps) {
  if (onboarding.pr_url) {
    return <a href={onboarding.pr_url}>Merge the onboarding PR</a>;
  }

  if (onboarding.last_task?.in_flight) {
    return (
      <Link href={`/tasks/${onboarding.last_task.id}`}>
        Onboarding is running
      </Link>
    );
  }

  return onboarding.last_task ? (
    <OnboardingFailure onboarding={onboarding} retry={retry} />
  ) : (
    <NeverOnboarded retry={retry} />
  );
}

/** The failed onboarding's reason and the button that queues it again. */
function OnboardingFailure({ onboarding, retry }: OnboardingStepProps) {
  return (
    <>
      Onboarding failed:{" "}
      {onboarding.last_task?.failure_reason ?? "no reason was recorded."}{" "}
      <OnboardButton label="Retry onboarding" retry={retry} />
    </>
  );
}

/** A repo nobody has tried to onboard yet: not a failure, just a step not taken. */
function NeverOnboarded({ retry }: Pick<OnboardingStepProps, "retry">) {
  return (
    <>
      This repo has not been onboarded yet.{" "}
      <OnboardButton label="Onboard this repo" retry={retry} />
    </>
  );
}

interface OnboardButtonProps {
  label: string;
  retry: () => Promise<void>;
}

/** Queues onboarding. Disabled for the length of the transition, like the toggle, so a double click cannot queue two. */
function OnboardButton({ label, retry }: OnboardButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="button"
      disabled={pending}
      onClick={() => startTransition(() => retry())}
    >
      {label}
    </button>
  );
}
