import { buildTagTree } from "./tag-tree";
import TagBox from "./TagBox";
import { TraceCard } from "./TraceCard";
import type { AssemblyTrace, TraceSection } from "./trace-types";
import styles from "./AssembledContextView.module.css";

interface TraceSourcesProps {
  owner: string;
  repo: string;
  sections: TraceSection[];
}

/** Every section the assembly considered, as one card each. */
export function TraceSources({ owner, repo, sections }: TraceSourcesProps) {
  return (
    <>
      <h3 className={styles.sourcesTitle}>Sources</h3>
      {sections.map((s) => (
        <TraceCard
          key={`${s.header}-${s.source}`}
          owner={owner}
          repo={repo}
          section={s}
        />
      ))}
    </>
  );
}

interface AssembledPromptProps {
  trace: AssemblyTrace;
  text: string;
  raw: boolean;
  onToggleRaw: () => void;
}

/** The same XML the runners receive, as a nested tag tree — or the raw text, for copying into somewhere that wants it verbatim. */
export function AssembledPrompt({
  trace,
  text,
  raw,
  onToggleRaw,
}: AssembledPromptProps) {
  return (
    <>
      <PromptToolbar raw={raw} text={text} onToggleRaw={onToggleRaw} />
      <TagBox node={buildTagTree(trace)} raw={raw} />
    </>
  );
}

/** Switch between the tag tree and the verbatim text, or take a copy. The label names the OTHER view — a toggle reading "Raw" while showing raw text says the wrong thing. */
function PromptToolbar({
  raw,
  text,
  onToggleRaw,
}: Pick<AssembledPromptProps, "raw" | "text" | "onToggleRaw">) {
  return (
    <div className={styles.promptHead}>
      <h3 className={styles.promptTitle}>Assembled prompt</h3>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => onToggleRaw()}
      >
        {raw ? "Rendered" : "Raw"}
      </button>
      <CopyButton text={text} />
    </div>
  );
}

function CopyButton({ text }: Pick<AssembledPromptProps, "text">) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      // lib.dom types navigator.clipboard as always present; insecure contexts and older browsers leave it undefined at runtime.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      onClick={() => void navigator.clipboard?.writeText(text)}
    >
      Copy
    </button>
  );
}
