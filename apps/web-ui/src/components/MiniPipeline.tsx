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

export interface MiniPipelineProps {
  runId: string;
  pipeline: readonly PipelineNode[];
  /** `bar`: one segment per stage filling the cell, as the run list draws it; dots otherwise. */
  variant?: "dots" | "bar";
}

const VARIANT_CLASS: Record<
  NonNullable<MiniPipelineProps["variant"]>,
  string
> = {
  dots: styles.miniPipeline,
  bar: `${styles.miniPipeline} ${styles.bar}`,
};

export default function MiniPipeline({
  runId,
  pipeline,
  variant = "dots",
}: MiniPipelineProps) {
  return (
    <a
      className={VARIANT_CLASS[variant]}
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
