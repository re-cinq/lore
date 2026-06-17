'use client';

import type { GapMockup } from '@/lib/feature-types';

// LLM-generated mockup markup is UNTRUSTED. Render it in a fully sandboxed
// iframe (empty sandbox = no scripts, opaque origin, no parent access) with a
// strict CSP injected into srcDoc. NEVER via dangerouslySetInnerHTML / rehype-raw.
// This is the security boundary (ADR-027 / specs/7-feature-planning § FR-3.3).
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function frameDoc(markup: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    '<style>html,body{margin:0;padding:8px;background:#fff}svg{max-width:100%;height:auto}</style>' +
    `</head><body>${markup}</body></html>`
  );
}

export default function MockupSection({ mockups }: { mockups: GapMockup[] }) {
  return (
    <div>
      {mockups.map((m, i) => (
        <figure key={i} style={{ margin: '0 0 12px' }}>
          {m.title && <figcaption className="meta" style={{ marginBottom: 4 }}>{m.title}</figcaption>}
          <iframe
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={frameDoc(m.markup)}
            title={m.title || `mockup ${i + 1}`}
            style={{ width: '100%', height: 320, border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, background: '#fff' }}
          />
        </figure>
      ))}
    </div>
  );
}
