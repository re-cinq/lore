"use client";

import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import type { GapMockup } from "@/lib/feature-types";

// LLM-generated mockup markup is UNTRUSTED. We render it inline (responsive,
// theme-aware) but sanitize every SVG with DOMPurify (SVG profile) on the client
// before it reaches the DOM — script/foreignObject/event-handlers/external refs
// are stripped. This is the security boundary (ADR-027 §FR-3.3). sanitizeSvg()
// also runs on the write path (defense in depth). NEVER inject m.markup without
// running it through cleanSvg() first.
const PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject"],
  FORBID_ATTR: ["onload", "onclick", "onmouseover", "onmouseenter", "onfocus"],
};

function downloadName(title: string | undefined, index: number): string {
  return `${(title || `mockup-${index + 1}`).replace(/[^\w.-]+/g, "-")}.svg`;
}

function MockupFigure({ mockup, index }: { mockup: GapMockup; index: number }) {
  const host = useRef<HTMLDivElement>(null);

  // Sanitize + inject after mount: keeps the raw markup off the server render (no
  // hydration mismatch) and out of React's virtual DOM entirely.
  useEffect(() => {
    if (host.current) {
      host.current.innerHTML = DOMPurify.sanitize(mockup.markup, PURIFY_CONFIG);
    }
  }, [mockup.markup]);

  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mockup.markup)}`;
  return (
    <figure style={{ margin: "0 0 12px" }}>
      <figcaption
        className="meta"
        style={{
          marginBottom: 4,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{mockup.title || `Mockup ${index + 1}`}</span>
        <a
          href={href}
          download={downloadName(mockup.title, index)}
          className="meta"
        >
          download ↓
        </a>
      </figcaption>
      <div ref={host} className="mockup-svg" />
    </figure>
  );
}

export default function MockupSection({ mockups }: { mockups: GapMockup[] }) {
  return (
    <div>
      {mockups.map((m, i) => (
        <MockupFigure key={i} mockup={m} index={i} />
      ))}
    </div>
  );
}
