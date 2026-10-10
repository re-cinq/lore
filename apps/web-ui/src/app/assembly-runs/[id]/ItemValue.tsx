// One ref of a need, a product or a bag item, shown the way a person reads it (run-viz FR4.4l): a short file in place, JSON as a tree, a link where it leads, text otherwise, each with a copy of the raw ref. A file too long to show, or not read yet, is a link to its own page.
import type { ReactNode } from "react";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import Markdown from "@/components/Markdown";
import type { BlobPreview } from "@/lib/blob-previews";
import { itemValueOf, type ItemValue as ShownValue } from "@/lib/item-value";
import FoldedValue from "./FoldedValue";
import JsonView from "./JsonView";
import styles from "./ItemValue.module.css";

const BLOB_PREFIX_CHARS = 19;
const TEXT_LIMIT_CHARS = 200;

interface ItemValueProps {
  runId: string;
  value: string;
  /** The file's first 4 KiB, when the value is a blob hash and it has been read. */
  preview?: BlobPreview;
}

export default function ItemValue({ runId, value, preview }: ItemValueProps) {
  return (
    <div className={styles.value}>
      <div className={styles.body}>
        <ValueBody runId={runId} value={value} preview={preview} />
      </div>
      <CopyButton text={value} />
    </div>
  );
}

function ValueBody({ runId, value, preview }: ItemValueProps) {
  const shown = itemValueOf(value, runId);
  const Body = BODIES[shown.kind] as (
    props: BodyProps<typeof shown>,
  ) => ReactNode;

  return <Body shown={shown} runId={runId} value={value} preview={preview} />;
}

interface BodyProps<Shown extends ShownValue> extends ItemValueProps {
  shown: Shown;
}

type BodyOf<Kind extends ShownValue["kind"]> = (
  props: BodyProps<Extract<ShownValue, { kind: Kind }>>,
) => ReactNode;

const BODIES: { [Kind in ShownValue["kind"]]: BodyOf<Kind> } = {
  blob: ({ runId, shown, preview }) => (
    <BlobValue runId={runId} hash={shown.hash} preview={preview} />
  ),
  json: ({ shown }) => <JsonValue value={shown.value} />,
  link: ({ shown, value }) => <ItemLink {...shown} label={value} />,
  text: ({ shown }) => <PlainValue value={shown.text} />,
};

function JsonValue({ value }: { value: unknown }) {
  return (
    <FoldedValue lines={jsonLines(value)}>
      <JsonView value={value} />
    </FoldedValue>
  );
}

interface BlobValueProps {
  runId: string;
  hash: string;
  preview?: BlobPreview;
}

/** A file read whole is shown in place, with its page a click away; one cut, unreadable as text, or not read yet is only that link. */
function BlobValue({ runId, hash, preview }: BlobValueProps) {
  const pageLink = <BlobPageLink runId={runId} hash={hash} />;

  return preview && preview.text !== null && !preview.truncated ? (
    <BlobInPlace
      runId={runId}
      preview={{ text: preview.text, contentType: preview.contentType }}
    >
      {pageLink}
    </BlobInPlace>
  ) : (
    pageLink
  );
}

interface InPlaceText {
  text: string;
  contentType: string;
}

function BlobInPlace({
  runId,
  preview,
  children,
}: {
  runId: string;
  preview: InPlaceText;
  children: ReactNode;
}) {
  return (
    <>
      <FoldedValue lines={textLines(preview.text)}>
        <BlobText runId={runId} {...preview} />
      </FoldedValue>
      <span className={styles.blobRef}>{children}</span>
    </>
  );
}

function BlobPageLink({ runId, hash }: { runId: string; hash: string }) {
  return (
    <Link
      className={styles.ref}
      href={`/assembly-runs/${runId}/blobs/${hash}`}
      title={hash}
    >
      {hash.slice(0, BLOB_PREFIX_CHARS)}…
    </Link>
  );
}

function BlobText({
  runId,
  text,
  contentType,
}: InPlaceText & { runId: string }) {
  if (contentType.startsWith("text/markdown")) {
    return <Markdown markdown={text} />;
  }
  const parsed = itemValueOf(text, runId);

  return parsed.kind === "json" ? (
    <JsonView value={parsed.value} />
  ) : (
    <pre className={styles.text}>{text}</pre>
  );
}

function ItemLink({
  href,
  external,
  label,
}: {
  href: string;
  external: boolean;
  label: string;
}) {
  return external ? (
    <a className={styles.ref} href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <Link className={styles.ref} href={href}>
      {label}
    </Link>
  );
}

/** What is not a link: short text as it is, anything longer cut so one item cannot take the card over. */
function PlainValue({ value }: { value: string }) {
  return value.length > TEXT_LIMIT_CHARS ? (
    <span className={styles.ref} title={value}>
      {value.slice(0, TEXT_LIMIT_CHARS)}…
    </span>
  ) : (
    <span className={styles.ref}>{value}</span>
  );
}

function textLines(text: string): number {
  return text.split("\n").length;
}

/** How tall the tree draws: a line per field or member, and a line per line of any text in it. */
function jsonLines(value: unknown): number {
  const pretty = JSON.stringify(value, null, 2);

  return textLines(pretty) + (pretty.match(/\\n/g)?.length ?? 0);
}
