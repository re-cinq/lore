import { Alert } from "@/components/Alert";
import {
  getChangelog,
  type ChangelogPage as ChangelogPageData,
} from "@/lib/api/changelog";
import type { ApiResult } from "@/lib/api/result";
import ChangelogView from "./ChangelogView";

interface ChangelogPageProps {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ before?: string; by?: string }>;
}

/** The Changelog tab: a page of the repository's weeks from lore-api (specs/repo-changelog FR6). */
export default async function ChangelogPage(props: ChangelogPageProps) {
  const [{ owner, repo }, { before, by }] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const fullName = `${owner}/${repo}`;
  const result = await getChangelog(fullName, { before });

  if (result.status !== "ok") {
    return <LoadFailure result={result} />;
  }

  return (
    <ChangelogView
      base={`/repos/${fullName}/changelog`}
      page={result.data}
      grouping={by === "person" ? "person" : "list"}
      before={before}
    />
  );
}

function LoadFailure({
  result,
}: {
  result: Exclude<ApiResult<ChangelogPageData>, { status: "ok" }>;
}) {
  const reason =
    result.status === "error" ? result.message : "Lore API unconfigured";

  return (
    <Alert variant="secondary">
      Could not load the changelog ({reason}) — check the Lore API connection
      and reload.
    </Alert>
  );
}
