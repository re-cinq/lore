import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders a short markdown string inline — bold, italics, inline code,
 * links — without the block <p> wrapper react-markdown emits by default,
 * so it can sit inside an existing paragraph (e.g. a spec card summary).
 */
export default function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
      {text}
    </ReactMarkdown>
  );
}
