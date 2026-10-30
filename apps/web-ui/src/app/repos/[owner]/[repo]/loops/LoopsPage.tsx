import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Alert } from "@/components/Alert";
import { getRepoLoops, type RepoLoop, type RepoLoops } from "@/lib/api/loops";
import type { ApiResult } from "@/lib/api/result";
import LoopBoard from "./board/LoopBoard";
import { pagingOf, type Paging } from "./board/section-limits";
import ImplementationExplainer from "./implementation/ImplementationExplainer";
import MergeExplainer from "./merge/MergeExplainer";
import ReviewExplainer from "./review/ReviewExplainer";
import TriageExplainer from "./triage/TriageExplainer";
import UpkeepExplainer from "./upkeep/UpkeepExplainer";
import DigestExplainer from "./digest/DigestExplainer";
import TicketsExplainer from "./tickets/TicketsExplainer";
import LoopBodyLoading from "./LoopBodyLoading";
import LoopPicker, { ALL_LOOPS } from "./LoopPicker";
import LoopSwitch from "./LoopSwitch";
import styles from "./LoopsPage.module.scss";
import { resumeLoopAction, switchLoopAction } from "./actions";

interface LoopsPageProps {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The Loops tab: All and every loop of the repository as pills with their state, the shown loops' switches, then one board of shared sections holding their rows (specs/implementation-loop FR9, specs/issue-triage FR27). */
export default async function LoopsPage(props: LoopsPageProps) {
  const [{ owner, repo }, query] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const fullName = `${owner}/${repo}`;
  const result = await getRepoLoops(fullName);

  if (result.status !== "ok") {
    return <LoadFailure result={result} />;
  }

  return (
    <LoopsView
      loops={result.data.loops}
      requested={requestedLoop(query)}
      shown={shownLoops(result.data.loops, requestedLoop(query))}
      fullName={fullName}
      paging={pagingOf(`/repos/${fullName}/loops`, query)}
    />
  );
}

/** The loop the address bar names, or All. */
function requestedLoop(query: Record<string, unknown>): string {
  return typeof query.loop === "string" ? query.loop : ALL_LOOPS;
}

interface LoopsViewProps {
  loops: readonly RepoLoop[];
  /** A loop's key, or `all`. */
  requested: string;
  shown: readonly RepoLoop[];
  fullName: string;
  paging: Paging;
}

function LoopsView(props: LoopsViewProps) {
  const { loops, requested, shown, fullName } = props;

  return (
    <div>
      <LoopPicker
        loops={loops}
        selected={requested}
        base={`/repos/${fullName}/loops`}
      />
      <Switches loops={shown} fullName={fullName} />
      {shown.length === 1 && <LoopExplainer loopKey={shown[0].key} />}
      <BoardArea {...props} />
    </div>
  );
}

/** The board under the switches; the page above it stays while a loop or a page of rows loads. */
function BoardArea({ requested, shown, fullName, paging }: LoopsViewProps) {
  return (
    <Suspense
      key={requested}
      fallback={<LoopBodyLoading label={boardLabel(shown)} />}
    >
      <LoopBoard loops={shown} fullName={fullName} paging={paging} />
    </Suspense>
  );
}

/** One switch per shown loop, each flipping its own loop. */
function Switches({
  loops,
  fullName,
}: {
  loops: readonly RepoLoop[];
  fullName: string;
}) {
  return (
    <div className={styles.switches}>
      {loops.map(({ key, ...loop }) => (
        <LoopSwitch
          key={key}
          {...loop}
          toggle={switchLoopAction.bind(null, fullName, key)}
          resume={resumeLoopAction.bind(null, fullName, key)}
        />
      ))}
    </div>
  );
}

function boardLabel(shown: readonly RepoLoop[]): string {
  return shown.length === 1 ? shown[0].label : "the loops";
}

const EXPLAINERS: Record<RepoLoop["key"], () => React.JSX.Element> = {
  implementation: ImplementationExplainer,
  review: ReviewExplainer,
  merge: MergeExplainer,
  triage: TriageExplainer,
  upkeep: UpkeepExplainer,
  digest: DigestExplainer,
  tickets: TicketsExplainer,
};

/** How one loop shown alone takes up work, said under its switch. */
function LoopExplainer({ loopKey }: { loopKey: RepoLoop["key"] }) {
  const Explainer = EXPLAINERS[loopKey];

  return <Explainer />;
}

/** Names the connection rather than the symptom: an unreachable API and a repository with no loops would otherwise look the same. */
function LoadFailure({
  result,
}: {
  result: Exclude<ApiResult<RepoLoops>, { status: "ok" }>;
}) {
  const reason =
    result.status === "error" ? result.message : "Lore API unconfigured";

  return (
    <Alert variant="secondary">
      Could not load the repository&apos;s loops ({reason}) — check the Lore API
      connection and reload.
    </Alert>
  );
}

/** Every loop for `all`, the one loop the query names otherwise, and a 404 when it names one the repository does not have. */
function shownLoops(loops: readonly RepoLoop[], requested: string): RepoLoop[] {
  if (requested === ALL_LOOPS) {
    return [...loops];
  }

  const found = loops.find((l) => l.key === requested);

  if (!found) {
    notFound();
  }

  return [found];
}
