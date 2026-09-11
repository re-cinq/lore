import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.css";

/** Renders a markdown string as styled prose (GitHub-flavoured); `className` lets a denser surface re-scale it. */
export default function Markdown({
  markdown,
  className = "",
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={`${styles.prose} ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
