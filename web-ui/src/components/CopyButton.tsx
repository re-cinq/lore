'use client';

import { useState } from 'react';
import styles from './CopyButton.module.css';

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
    <button type="button" className={`btn-secondary ${styles.button}`} onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
