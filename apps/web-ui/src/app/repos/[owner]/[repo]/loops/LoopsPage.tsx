import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Alert } from "@/components/Alert";
import {
  getRepoLoops,
  type LoopKey,
  type RepoLoop,
  type RepoLoops,
} from "@/lib/api/loops";
import type { ApiResult } from "@/lib/api/result";
import ImplementationLoopBody from "./implementation/ImplementationLoopBody";
import ReviewBody from "./review/ReviewBody";
import TriageBody from "./triage/TriageBody";
import LoopBodyLoading from "./LoopBodyLoading";
import LoopPicker, { ALL_LOOPS } from "./LoopPicker";
import LoopSwitch from "./LoopSwitch";
import styles from "./LoopsPage.module.scss";
import { switchLoopAction } from "./actions";

interface LoopsPageProps {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ loop?: string }>;
}

/** The Loops tab: All and every loop of the repository as pills with their state, then each chosen loop's switch and its own page (specs/implementation-loop FR9, specs/issue-triage FR27). */
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
      {shown.map((loop) => (
        <LoopSection key={loop.key} loop={loop} fullName={fullName} />
      ))}
    </div>
  );
}

/** One loop: its switch at once, its lists as soon as they are read, a skeleton until then. */
function LoopSection({ loop, fullName }: { loop: RepoLoop; fullName: string }) {
  return (
    <section className={styles.section} aria-label={loop.label}>
      <LoopSwitch
        label={loop.label}
        description={loop.description}
        enabled={loop.enabled}
        toggle={switchLoopAction.bind(null, fullName, loop.key)}
      />
      <Suspense fallback={<LoopBodyLoading label={loop.label} />}>
        <LoopBody loopKey={loop.key} fullName={fullName} />
      </Suspense>
    </section>
  );
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

function LoopBody({
  loopKey,
  fullName,
}: {
  loopKey: LoopKey;
  fullName: string;
}) {
  if (loopKey === "triage") {
    return <TriageBody fullName={fullName} />;
  }

  if (loopKey === "review") {
    return <ReviewBody fullName={fullName} />;
  }

  return <ImplementationLoopBody fullName={fullName} />;
}
