// A blob the floor keeps, shown the way the Needs card promised (run-viz FR4.4m): markdown rendered, other text verbatim, anything else described. Pure render.
import Link from "next/link";
import Markdown from "@/components/Markdown";
import type { RunBlob } from "@/lib/run-blob";
import styles from "./RunBlobView.module.css";

export interface RunBlobViewProps {
  runId: string;
  blob: RunBlob;
}

export default function RunBlobView({ runId, blob }: RunBlobViewProps) {
  return (
    <div>
      <div className="breadcrumb">
        <Link href="/assembly-runs">Assembly Runs</Link> /{" "}
        <Link href={`/assembly-runs/${runId}`}>{runId}</Link> / blob
      </div>
      <code className={styles.hash}>{blob.hash}</code>
      <span className="meta">{`${blob.contentType} · ${blob.size} bytes`}</span>
      {blob.truncated ? (
        <p className="meta">Only the first 1 MiB is shown.</p>
      ) : null}
      <BlobBody blob={blob} />
    </div>
  );
}

function BlobBody({ blob }: { blob: RunBlob }) {
  if (blob.text === null) {
    return (
      <p>{`${blob.contentType}, ${blob.size} bytes: not text, so there is nothing to show.`}</p>
    );
  }

  return blob.contentType.startsWith("text/markdown") ? (
    <Markdown markdown={blob.text} />
  ) : (
    <pre className={styles.text}>{blob.text}</pre>
  );
}
