import type { PipelineNode } from "@/lib/assembly-run-rows";
import styles from "./MiniPipeline.module.scss";

/** Tone per node state: unrecognised renders as failed-red so new outcomes are loud. */
const DOT_STATES = new Set([
  "success",
  "running",
  "waiting",
  "pending",
  "changes_requested",
  "stalled",
]);

export default function MiniPipeline({
  runId,
  pipeline,
}: {
  runId: string;
  pipeline: readonly PipelineNode[];
}) {
  return (
    <a
      className={styles.miniPipeline}
      href={`/assembly-runs/${runId}`}
      title="Open the live run"
      data-testid="mini-pipeline"
    >
      {pipeline.map((node) => (
        <PipelineDot key={node.node_id} node={node} />
      ))}
    </a>
  );
}

function PipelineDot({ node }: { node: PipelineNode }) {
  const state = DOT_STATES.has(node.state) ? node.state : "failed";

  return (
    <span
      title={`${node.node_id}: ${node.state}`}
      data-testid={`mini-node-${node.node_id}`}
      className={`${styles.dot} ${styles[state as keyof typeof styles]}`}
    />
  );
}
