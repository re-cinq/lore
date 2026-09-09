import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders markdown inline, without the block <p> wrapper react-markdown emits by default, so it can sit inside an existing paragraph. */
export default function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ p: ({ children }) => <>{children}</> }}
    >
      {text}
    </ReactMarkdown>
  );
}
