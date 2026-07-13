"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./PoolDetailView.module.css";

const btnStyle = { padding: "2px 8px", fontSize: 11 };

export function PoolValueCell({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = value.length > 200;
  const shown = expanded || !long ? value : `${value.substring(0, 200)}…`;

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <td className={styles.valueCell}>
      <pre className={styles.valuePre}>{shown}</pre>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {long && (
          <button
            type="button"
            className="btn-secondary"
            style={btnStyle}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          style={btnStyle}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </td>
  );
}
