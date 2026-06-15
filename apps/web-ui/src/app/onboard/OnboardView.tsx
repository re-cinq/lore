import styles from './OnboardView.module.css';

export interface OnboardViewProps {
  /** Already-onboarded repos, used for the count + the "Already onboarded: …" hint. */
  onboarded: { full_name: string }[];
  /** Server action wired to the onboard form ("actions up"). */
  onboardRepoAction: (formData: FormData) => void | Promise<void>;
}

/**
 * Presentational view for self-service repo onboarding. Pure render — the
 * onboarded-repo list is resolved by the container (`page.tsx`) and passed
 * down; the only mutation (onboard a repo) is handed in as `onboardRepoAction`
 * and fired back up via the form, keeping this component free of data access.
 */
export default function OnboardView({ onboarded, onboardRepoAction }: OnboardViewProps) {
  return (
    <div>
      <h1>Add Repository</h1>
      <p className="meta">Onboard a repository to Lore. This will create a PR on the target repo with CLAUDE.md, AGENTS.md, PR template, and CI workflows.</p>

      <form action={onboardRepoAction} className={`task-form ${styles.form}`}>
        <label>Repository (owner/name)</label>
        <input type="text" name="full_name" required placeholder="re-cinq/my-service"
          pattern="[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+"
          title="Format: owner/repo" />
        <p className={`meta ${styles.hint}`}>
          The GitHub App must have access to this repo.
          {onboarded.length > 0 && ` Already onboarded: ${onboarded.map((r) => r.full_name).join(', ')}`}
        </p>
        <button type="submit" className={styles.submit}>Onboard Repository</button>
      </form>
    </div>
  );
}
