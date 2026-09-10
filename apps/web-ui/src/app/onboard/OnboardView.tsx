"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { FormError } from "@/components/FormError";
import styles from "./OnboardView.module.css";

export type OnboardState = { error?: string; fullName?: string } | null;

export interface OnboardViewProps {
  /** Already-onboarded repos, used for the count + the "Already onboarded: …" hint. */
  onboarded: { full_name: string }[];
  /** Server action wired to the onboard form ("actions up"). */
  onboardRepoAction: (
    prev: OnboardState,
    formData: FormData,
  ) => Promise<OnboardState>;
}

interface RepoFieldProps {
  defaultValue: string;
  onboarded: OnboardViewProps["onboarded"];
}

/** Onboarding view; pure render with onboardRepoAction callback (no data access). */
export default function OnboardView({
  onboarded,
  onboardRepoAction,
}: OnboardViewProps) {
  const [state, formAction] = useActionState(onboardRepoAction, null);

  return (
    <div>
      <OnboardHeading />

      <form action={formAction} className={`task-form ${styles.form}`}>
        <RepoField defaultValue={state?.fullName ?? ""} onboarded={onboarded} />
        <FormError message={state?.error} />
        <SubmitButton className={styles.submit} pendingLabel="Onboarding…">
          Onboard Repository
        </SubmitButton>
      </form>
    </div>
  );
}

function OnboardHeading() {
  return (
    <>
      <h1>Add Repository</h1>
      <p className="meta">
        Onboard a repository to Lore. This will create a PR on the target repo
        with CLAUDE.md, AGENTS.md, PR template, and CI workflows.
      </p>
    </>
  );
}

/** The one thing this form asks for. Refills itself from the rejected value so a typo is corrected rather than retyped, and lists what is already onboarded — the commonest reason an attempt is refused. */
function RepoField({ defaultValue, onboarded }: RepoFieldProps) {
  return (
    <>
      <label>Repository (owner/name)</label>
      <input
        type="text"
        name="full_name"
        required
        placeholder="re-cinq/my-service"
        pattern="[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+"
        title="Format: owner/repo"
        defaultValue={defaultValue}
      />
      <RepoFieldHint onboarded={onboarded} />
    </>
  );
}

function RepoFieldHint({ onboarded }: Pick<RepoFieldProps, "onboarded">) {
  return (
    <p className={`meta ${styles.hint}`}>
      Format: <code>owner/name</code>. The GitHub App must have access to this
      repo.
      {onboarded.length > 0 &&
        ` Already onboarded: ${onboarded.map((r) => r.full_name).join(", ")}`}
    </p>
  );
}
