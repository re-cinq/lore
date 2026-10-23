"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runsHref } from "./runs-href";
import styles from "./AssemblyRunListView.module.css";

export interface RepoFilterProps {
  /** `owner/name` of every onboarded repository. */
  repos: string[];
  activeRepo?: string;
  activeStatus?: string;
}

/** Narrows the run list to one repository, keeping the status filter and going back to the newest page. */
export default function RepoFilter(props: RepoFilterProps) {
  const { picked, isPending, pickRepo } = useRepoPick(props);

  return (
    <label className={`task-form ${styles.repoFilter}`}>
      <span>
        Repository
        {isPending && <span className="chip-spinner" aria-hidden="true" />}
      </span>
      <select
        value={picked}
        aria-busy={isPending}
        onChange={(event) => pickRepo(event.target.value)}
      >
        <RepoOptions repos={props.repos} />
      </select>
    </label>
  );
}

/** The pick shows at once and stays pending until the page for it arrives; the select would otherwise snap back to the repository the page was read for. */
function useRepoPick({ activeRepo, activeStatus }: RepoFilterProps) {
  const router = useRouter();
  const [picked, setPicked] = useState(activeRepo ?? "");
  // eslint-disable-next-line no-restricted-syntax -- a router.push transition, not an HTTP action; nothing here for PendingActionButton to await
  const [isPending, startTransition] = useTransition();
  const pickRepo = (repo: string) => {
    setPicked(repo);
    startTransition(() =>
      router.push(runsHref({ repo, status: activeStatus })),
    );
  };

  return { picked, isPending, pickRepo };
}

function RepoOptions({ repos }: Pick<RepoFilterProps, "repos">) {
  return (
    <>
      <option value="">All repos</option>
      {repos.map((repo) => (
        <option key={repo} value={repo}>
          {repo}
        </option>
      ))}
    </>
  );
}
