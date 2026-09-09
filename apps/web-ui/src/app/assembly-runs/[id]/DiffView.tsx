// Pure diff rendering (lore/no-io-in-view): the drawer above fetches and matches; this view only lays out the model it is handed.
import type { DiffViewModel } from "@/lib/pull-file-diff";
import type { DiffLine, DiffLineKind } from "@/lib/unified-diff";
import styles from "./DiffView.module.css";

export interface DiffViewProps {
  model: DiffViewModel;
}

const PREFIX: Record<DiffLineKind, string> = {
  add: "+",
  del: "-",
  ctx: " ",
  hunk: " ",
};

function DiffRow({ line, index }: { line: DiffLine; index: number }) {
  return (
    <div className={styles.line} data-diff-line={line.kind} key={index}>
      <span className={styles.lineNo}>{line.oldNo ?? ""}</span>
      <span className={styles.lineNo}>{line.newNo ?? ""}</span>
      <span className={styles.prefix}>{PREFIX[line.kind]}</span>
      <span className={styles.text}>{line.text}</span>
    </div>
  );
}

function DiffHeader({
  model,
}: {
  model: Extract<DiffViewModel, { kind: "diff" }>;
}) {
  const { file, stats } = model;

  return (
    <div className={styles.header}>
      <span className={styles.filename}>{file.filename}</span>
      <span className={styles.stats}>
        <span className={styles.added}>+{stats.added}</span>{" "}
        <span className={styles.removed}>−{stats.removed}</span>
      </span>
      <span className="meta">{file.status}</span>
    </div>
  );
}

export default function DiffView({ model }: DiffViewProps) {
  if (model.kind === "absent") {
    return <span className="meta">Not changed in this PR.</span>;
  }

  if (model.kind === "binary") {
    return <span className="meta">No text diff for this file.</span>;
  }

  return (
    <div className={styles.diff}>
      <DiffHeader model={model} />
      <div className={styles.lines}>
        {model.lines.map((line, index) => (
          <DiffRow key={index} line={line} index={index} />
        ))}
      </div>
    </div>
  );
}
