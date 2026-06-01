'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

export interface TestLink {
  name: string;
  file_path: string;
  line: number | null;
  symbol: string | null;
  match_kind: string;
  rationale: string;
  url: string;
}

function shortFile(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

export default function SpecDetails({ content, tests }: { content: string; tests: TestLink[] }) {
  return (
    <div>
      <div className="content-viewer">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>

      <h3 style={{ marginTop: 24 }}>Tests validating this spec ({tests.length})</h3>
      {tests.length === 0 ? (
        <p className="meta">○ No tests linked to this spec yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tests.map((test, i) => (
            <li key={`${test.file_path}-${test.name}-${i}`} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
              <details>
                <summary style={{ display: 'flex', justifyContent: 'space-between', gap: 12, cursor: 'pointer', alignItems: 'baseline' }}>
                  <span>{test.name}</span>
                  <a
                    href={test.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {shortFile(test.file_path)}{test.line ? `:${test.line}` : ''} ↗
                  </a>
                </summary>
                <div className="meta" style={{ marginTop: 6, paddingLeft: 16 }}>
                  └ judge: {test.rationale}
                  {test.symbol && <> · symbol: <code>{test.symbol}</code></>}
                  {' · match: '}{test.match_kind}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
