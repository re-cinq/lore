import { buildTagTree } from "./tag-tree";
import TagBox from "./TagBox";
import { TraceCard } from "./TraceCard";
import type { AssembledContextViewProps } from "./AssembledContextView";
import styles from "./AssembledContextView.module.css";

export function TraceSources({
  owner,
  repo,
  sections,
}: {
  owner: string;
  repo: string;
  sections: NonNullable<
    NonNullable<AssembledContextViewProps["result"]>["trace"]
  >["sections"];
}) {
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

/** The same XML the runners receive, as a nested tag tree — or the raw text, for copying into somewhere that wants it verbatim. */
export function AssembledPrompt({
  trace,
  text,
  raw,
  onToggleRaw,
}: {
  trace: NonNullable<NonNullable<AssembledContextViewProps["result"]>["trace"]>;
  text: string;
  raw: boolean;
  onToggleRaw: () => void;
}) {
  return (
    <>
      {/* Final prompt as nested tag tree */}
      <div className={styles.promptHead}>
        <h3 className={styles.promptTitle}>Assembled prompt</h3>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onToggleRaw()}
        >
          {raw ? "Rendered" : "Raw"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          Copy
        </button>
      </div>
      <TagBox node={buildTagTree(trace)} raw={raw} />
    </>
  );
}
