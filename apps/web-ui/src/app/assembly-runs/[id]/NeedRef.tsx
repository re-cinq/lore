// One ref of a need or a bag item, shown where it leads (run-viz FR4.4l): a link when it names a branch, a URL or a blob, text otherwise. A blob hash is shortened to read, a long text is cut, and both are whole on hover.
import Link from "next/link";
import { needLink } from "@/lib/need-link";

const BLOB_PREFIX_CHARS = 19;
const TEXT_LIMIT_CHARS = 200;

interface NeedRefProps {
  runId: string;
  value: string;
}

export default function NeedRef({ runId, value }: NeedRefProps) {
  const link = needLink(value, runId);

  if (link === null) {
    return <PlainValue value={value} />;
  }

  return link.external ? (
    <a href={link.href} target="_blank" rel="noreferrer">
      {value}
    </a>
  ) : (
    <Link href={link.href} title={value}>
      {value.slice(0, BLOB_PREFIX_CHARS)}…
    </Link>
  );
}

/** What is not a link: short text as it is, anything longer cut so one item cannot take the card over. */
function PlainValue({ value }: { value: string }) {
  return value.length > TEXT_LIMIT_CHARS ? (
    <span title={value}>{value.slice(0, TEXT_LIMIT_CHARS)}…</span>
  ) : (
    value
  );
}
