// The repositories tonight's context evals cover: every onboarded repository whose onboarding pull request merged, or the one a manual run names. Prints them as a JSON array for the workflow's matrix.

import { pathToFileURL } from "node:url";
import { loreApi } from "./lore-api.mjs";

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const PAGE = 100;

export async function reposToEvaluate({ env, fetchFn, only }) {
  if (only) {
    return [namedRepo(only)];
  }
  const api = loreApi({ env, fetchFn });
  const names = [];

  for (let offset = 0; ; offset += PAGE) {
    const { repos, total } = await api.get(
      `/api/repos?limit=${PAGE}&offset=${offset}`,
    );

    names.push(...repos.filter(isOnboarded).map((repo) => repo.full_name));

    if (repos.length === 0 || offset + PAGE >= total) {
      return names;
    }
  }
}

function namedRepo(name) {
  if (!REPO_NAME.test(name)) {
    throw new Error(`${JSON.stringify(name)} is not an owner/name repository`);
  }

  return name;
}

function isOnboarded(repo) {
  return repo.onboarding_pr_merged === true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repos = await reposToEvaluate({
    env: process.env,
    only: process.env.EVAL_REPO,
  });

  console.log(JSON.stringify(repos));
}
