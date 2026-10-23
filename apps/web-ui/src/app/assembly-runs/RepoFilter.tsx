"use client";

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
export default function RepoFilter({
  repos,
  activeRepo,
  activeStatus,
}: RepoFilterProps) {
  const router = useRouter();

  return (
    <label className={`task-form ${styles.repoFilter}`}>
      Repository
      <select
        value={activeRepo ?? ""}
        onChange={(event) =>
          router.push(
            runsHref({ repo: event.target.value, status: activeStatus }),
          )
        }
      >
        <option value="">All repos</option>
        {repos.map((repo) => (
          <option key={repo} value={repo}>
            {repo}
          </option>
        ))}
      </select>
    </label>
  );
}
