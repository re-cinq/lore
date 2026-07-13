import { parseReferences, type RefContext } from "@/lib/references";

/**
 * Render text with file paths, issue numbers, and task UUIDs turned into links.
 * Internal pipeline links (starting with "/") open in place; GitHub links open
 * in a new tab.
 */
export default function Linkified({
  text,
  repo,
  branch,
}: { text: string } & RefContext) {
  const segments = parseReferences(text, { repo, branch });

  return (
    <>
      {segments.map((s, i) =>
        s.href ? (
          <a
            key={i}
            href={s.href}
            target={s.href.startsWith("/") ? undefined : "_blank"}
          >
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
