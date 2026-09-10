import { parseReferences, type RefContext } from "@/lib/references";

type LinkifiedProps = { text: string } & RefContext;

export default function Linkified({ text, repo, branch }: LinkifiedProps) {
  const segments = parseReferences(text, { repo, branch });

  return (
    <>
      {segments.map((s, i) =>
        s.href ? (
          <RefLink key={i} href={s.href} text={s.text} />
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Internal pipeline links (starting with "/") open in place; GitHub links open in a new tab. */
function RefLink({ href, text }: { href: string; text: string }) {
  return (
    <a href={href} target={href.startsWith("/") ? undefined : "_blank"}>
      {text}
    </a>
  );
}
