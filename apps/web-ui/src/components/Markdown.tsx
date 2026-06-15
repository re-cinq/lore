import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

/** Renders a markdown string as styled prose (GitHub-flavoured). */
export default function Markdown({ markdown }: { markdown: string }) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
