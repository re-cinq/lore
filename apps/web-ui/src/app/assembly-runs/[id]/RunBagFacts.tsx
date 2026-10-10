"use client";

// What the line has put in the run's bag, by name (run-viz FR4.4n): each value shown the way a need is (FR4.4l), with its kind, the attempt that put it there as a link to that attempt, and a git item's commit linked on GitHub. Nothing to say, nothing drawn.
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { BlobPreview } from "@/lib/blob-previews";
import { commitLink } from "@/lib/need-link";
import type { RunBag } from "@/lib/run-bag";
import ItemValue from "./ItemValue";
import { useRunFocus } from "./run-focus-context";
import { useBlobPreviews } from "./use-blob-previews";
import styles from "./AssemblyRunView.module.css";

const SHORT_SHA_CHARS = 7;

type BagItem = RunBag[string];

interface RunBagFactsProps {
  runId: string;
  bag: RunBag | null;
  /** The run's attempts, which name the visit an item's `by` points at. */
  nodes: readonly AssemblyRunNode[];
}

export default function RunBagFacts({ runId, bag, nodes }: RunBagFactsProps) {
  const { bagEntries, previews } = useBagEntries(runId, bag);

  return bagEntries.length === 0 ? null : (
    <div className={styles.bag}>
      <div className={styles.bagHead}>Bag ({bagEntries.length})</div>
      <dl className={styles.facts}>
        {bagEntries.map(([name, bagItem]) => (
          <BagEntry
            key={name}
            name={name}
            bagItem={bagItem}
            runId={runId}
            nodes={nodes}
            preview={previews[bagItem.ref]}
          />
        ))}
      </dl>
    </div>
  );
}

/** The bag's items by name, and the previews of those that are files. */
function useBagEntries(runId: string, bag: RunBag | null) {
  const bagEntries = Object.entries(bag ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const previews = useBlobPreviews(
    runId,
    bagEntries.map(([, bagItem]) => bagItem.ref),
  );

  return { bagEntries, previews };
}

interface BagEntryProps {
  name: string;
  bagItem: BagItem;
  runId: string;
  nodes: readonly AssemblyRunNode[];
  preview?: BlobPreview;
}

function BagEntry({ name, bagItem, runId, nodes, preview }: BagEntryProps) {
  return (
    <div className={styles.bagEntry}>
      <dt>{name}</dt>
      <dd>
        <ItemValue runId={runId} value={bagItem.ref} preview={preview} />
        <BagMeta bagItem={bagItem} nodes={nodes} />
      </dd>
    </div>
  );
}

/** Its kind, who put it there and, for a git item, the commit it was promised. */
function BagMeta({ bagItem, nodes }: Omit<BagEntryProps, "name" | "runId">) {
  return (
    <span className={styles.bagMeta}>
      {bagItem.kind} · <PutBy by={bagItem.by} nodes={nodes} />
      <CommitRef bagItem={bagItem} />
    </span>
  );
}

interface PutByProps {
  by: string;
  nodes: readonly AssemblyRunNode[];
}

/** A visit id names the attempt that put the item there, a link to it on the run page; anything else (hook, lore) is said as it is. */
function PutBy({ by, nodes }: PutByProps) {
  const focusAttempt = useRunFocus();
  const attempt = nodes.find((node) => node.stationRunId === by);

  if (!attempt || !focusAttempt) {
    return <>{attempt ? attemptLabel(attempt) : by}</>;
  }

  return (
    <button
      type="button"
      className={styles.putBy}
      onClick={() => focusAttempt(attempt.nodeId, attempt.iteration)}
    >
      {attemptLabel(attempt)}
    </button>
  );
}

function attemptLabel(attempt: AssemblyRunNode): string {
  return `${attempt.nodeId} · attempt ${attempt.iteration}`;
}

function CommitRef({ bagItem }: { bagItem: BagItem }) {
  if (!bagItem.sha) {
    return null;
  }
  const short = bagItem.sha.slice(0, SHORT_SHA_CHARS);
  const href = commitLink(bagItem.ref, bagItem.sha);

  return (
    <>
      {" · "}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {short}
        </a>
      ) : (
        short
      )}
    </>
  );
}
