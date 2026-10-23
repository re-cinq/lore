import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Alert } from "@/components/Alert";
import { getRepoLoops, type RepoLoop, type RepoLoops } from "@/lib/api/loops";
import type { ApiResult } from "@/lib/api/result";
import LoopBoard from "./board/LoopBoard";
import ImplementationExplainer from "./implementation/ImplementationExplainer";
import MergeExplainer from "./merge/MergeExplainer";
import ReviewExplainer from "./review/ReviewExplainer";
import TriageExplainer from "./triage/TriageExplainer";
import UpkeepExplainer from "./upkeep/UpkeepExplainer";
import LoopBodyLoading from "./LoopBodyLoading";
import LoopPicker, { ALL_LOOPS } from "./LoopPicker";
import LoopSwitch from "./LoopSwitch";
import styles from "./LoopsPage.module.scss";
import { switchLoopAction } from "./actions";

interface LoopsPageProps {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ loop?: string }>;
}

/** The Loops tab: All and every loop of the repository as pills with their state, the shown loops' switches, then one board of shared sections holding their rows (specs/implementation-loop FR9, specs/issue-triage FR27). */
export default async function LoopsPage(props: LoopsPageProps) {
  const [{ owner, repo }, { loop }] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const fullName = `${owner}/${repo}`;
  const result = await getRepoLoops(fullName);

  if (result.status !== "ok") {
    return <LoadFailure result={result} />;
  }

  const requested = loop ?? ALL_LOOPS;

  return (
    <LoopsView
      loops={result.data.loops}
      requested={requested}
      shown={shownLoops(result.data.loops, requested)}
      fullName={fullName}
    />
  );
}

interface LoopsViewProps {
  loops: readonly RepoLoop[];
  /** A loop's key, or `all`. */
  requested: string;
  shown: readonly RepoLoop[];
  fullName: string;
}

function LoopsView({ loops, requested, shown, fullName }: LoopsViewProps) {
  return (
    <div>
      <LoopPicker
        loops={loops}
        selected={requested}
        base={`/repos/${fullName}/loops`}
      />
      <Switches loops={shown} fullName={fullName} />
      {shown.length === 1 && <LoopExplainer loopKey={shown[0].key} />}
      <Suspense
        key={requested}
        fallback={<LoopBodyLoading label={boardLabel(shown)} />}
      >
        <LoopBoard loops={shown} fullName={fullName} />
      </Suspense>
    </div>
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
