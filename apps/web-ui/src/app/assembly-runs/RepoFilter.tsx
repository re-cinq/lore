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
export default function RepoFilter(props: RepoFilterProps) {
  const router = useRouter();
  const pickRepo = (repo: string) =>
    router.push(runsHref({ repo, status: props.activeStatus }));

  return (
    <label className={`task-form ${styles.repoFilter}`}>
      Repository
      <select
        value={props.activeRepo ?? ""}
        onChange={(event) => pickRepo(event.target.value)}
      >
        <RepoOptions repos={props.repos} />
      </select>
    </label>
  );
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
