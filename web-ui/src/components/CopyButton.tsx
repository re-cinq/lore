'use client';

import { useState } from 'react';

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <button type="button" className="btn-secondary" style={{ fontSize: 'var(--fs-xs)', padding: '4px 10px' }} onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
