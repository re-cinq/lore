"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { SettingsHeader } from "@/components/SettingsHeader";
import Icon from "@/components/Icon";
import styles from "./OnboardView.module.css";

export type OnboardState = { error?: string; fullName?: string } | null;

export interface OnboardViewProps {
  /** Already-onboarded repos, used for the "Already onboarded: …" hint. */
  onboarded: { full_name: string }[];
  /** Repos the GitHub App can access that are not onboarded yet; the picker's suggestions. */
  available?: { full_name: string }[];
  /** Server action wired to the onboard form ("actions up"). */
  onboardRepoAction: (
    prev: OnboardState,
    formData: FormData,
  ) => Promise<OnboardState>;
}

/** What the onboarding pull request adds to the target repository. */
const PR_FILES = [
  { file: "CLAUDE.md, AGENTS.md", what: "Conventions and context for agents" },
  { file: "PR template", what: "What every pull request describes" },
  { file: "CI workflows", what: "Ingest and test tracing on push to main" },
];

const ONBOARD_LEDE =
  "Lore opens a PR on the target repo. Once it merges, the first ingest runs and Claude Code sessions in that repo pick up its context.";

const HEADER = (
  <SettingsHeader
    eyebrow="{work}"
    title="Add a repository"
    lede={ONBOARD_LEDE}
  />
);

/** Onboarding view; pure render with onboardRepoAction callback (no data access). */
export default function OnboardView({
  onboarded,
  available,
  onboardRepoAction,
}: OnboardViewProps) {
  const [state, formAction] = useActionState(onboardRepoAction, null);

  return (
    <div className={styles.page}>
      {HEADER}
      <form action={formAction} className={`task-form ${styles.card}`}>
        <RepoField state={state} available={available} />
        <PrFiles />
        <FormFooter onboarded={onboarded} />
      </form>
    </div>
  );
}

interface RepoFieldProps {
  state: OnboardState;
  available?: { full_name: string }[];
}

/** The one thing this form asks for. Refills itself from the rejected value so a typo is corrected rather than retyped. */
function RepoField({ state, available }: RepoFieldProps) {
  const error = state?.error;

  return (
    <div className={styles.field}>
      <label htmlFor="full_name">Repository</label>
      <span
        className={`${styles.inputWrap}${error ? ` ${styles.invalid}` : ""}`}
      >
        <Icon name="github" size={18} className={styles.inputIcon} />
        <RepoInput
          defaultValue={state?.fullName ?? ""}
          invalid={Boolean(error)}
        />
        <AvailableRepos available={available} />
      </span>
      {error ? <RepoError message={error} /> : <RepoHint />}
    </div>
  );
}

/** The picker's suggestions: native datalist options, so choosing one fills the slug and typing still works when there are none. */
function AvailableRepos({ available = [] }: Pick<RepoFieldProps, "available">) {
  return (
    <datalist id="available-repos">
      {available.map((repo) => (
        <option key={repo.full_name} value={repo.full_name} />
      ))}
    </datalist>
  );
}

interface RepoInputProps {
  defaultValue: string;
  invalid: boolean;
}

function RepoInput({ defaultValue, invalid }: RepoInputProps) {
  return (
    <input
      id="full_name"
      type="text"
      name="full_name"
      list="available-repos"
      required
      placeholder="re-cinq/my-service"
      pattern="[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+"
      title="Format: owner/repo"
      defaultValue={defaultValue}
      aria-invalid={invalid || undefined}
    />
  );
}

/** The refusal in place of the hint, so it sits under the field it is about. */
function RepoError({ message }: { message: string }) {
  return (
    <p role="alert" className={styles.error}>
      <Icon name="warning" size={14} />
      {message}
    </p>
  );
}

function RepoHint() {
  return (
    <p className={styles.hint}>
      Format: <code>owner/name</code>. The GitHub App must have access to this
      repo.
    </p>
  );
}

function PrFiles() {
  return (
    <div className={styles.field}>
      <span className={styles.groupLabel}>The PR adds</span>
      <ul className={styles.files}>
        {PR_FILES.map(({ file, what }) => (
          <li key={file} className={styles.fileCard}>
            <span className={styles.fileName}>{file}</span>
            <span className={styles.fileWhat}>{what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lists what is already onboarded beside the submit — the commonest reason an attempt is refused. */
function FormFooter({ onboarded }: Pick<OnboardViewProps, "onboarded">) {
  return (
    <div className={styles.footer}>
      {onboarded.length > 0 && <OnboardedList onboarded={onboarded} />}
      <SubmitButton className={styles.submit} pendingLabel="Onboarding…">
        Open onboarding PR
        <Icon name="arrowRight" size={16} />
      </SubmitButton>
    </div>
  );
}

function OnboardedList({ onboarded }: Pick<OnboardViewProps, "onboarded">) {
  return (
    <p className={styles.onboarded}>
      Already onboarded:
      {onboarded.map((repo) => (
        <span key={repo.full_name} className={styles.repoPill}>
          {repo.full_name}
        </span>
      ))}
    </p>
  );
}
