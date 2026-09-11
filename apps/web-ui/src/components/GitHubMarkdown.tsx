import ReactMarkdown, { type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import styles from "./Markdown.module.css";

interface GitHubMarkdownProps {
  markdown: string;
  /** Rewrites link and image URLs; omitted, they pass through react-markdown's default. */
  urlTransform?: UrlTransform;
}

/** Repo content as GitHub renders it: GFM, with raw HTML let through but sanitized, since READMEs and issue bodies carry badges, <details> and template comments a plain markdown pass would print or drop. */
export default function GitHubMarkdown({
  markdown,
  urlTransform,
}: GitHubMarkdownProps) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        urlTransform={urlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
