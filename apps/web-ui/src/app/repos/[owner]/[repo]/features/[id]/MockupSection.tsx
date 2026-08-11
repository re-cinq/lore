"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import type { GapMockup } from "@/lib/feature-types";
import { mockupFrameSrcdoc, mockupHeight } from "@/lib/mockup-frame";

// LLM-generated mockup markup is UNTRUSTED. Two boundaries, not one:
//
//  1. `sandbox=""` on the frame — no scripting, no same-origin, no parent access.
//     This is what lets a mockup carry the PLANNED repo's stylesheet at all; a
//     `<style>` inside an inline svg applies document-wide, so the old inline
//     rendering would have let a mockup restyle the wizard around it.
//  2. DOMPurify over the markup before it goes in, with the profile that matches
//     the format — the svg profile would strip an html mockup's divs to nothing.
//
// sanitizeGapResult() runs on the write path too (defense in depth). NEVER put
// mockup markup anywhere but inside the frame.
const SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject"],
  FORBID_ATTR: ["onload", "onclick", "onmouseover", "onmouseenter", "onfocus"],
};
const HTML_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "base"],
  FORBID_ATTR: ["onload", "onclick", "onmouseover", "onmouseenter", "onfocus"],
};

const DOWNLOAD_EXTENSION: Record<string, string> = {
  svg: "svg",
  html: "html",
  mermaid: "mmd",
};

function downloadName(mockup: GapMockup, index: number): string {
  const stem = (mockup.title || `mockup-${index + 1}`).replace(
    /[^\w.-]+/g,
    "-",
  );

  return `${stem}.${DOWNLOAD_EXTENSION[mockup.format ?? "svg"] ?? "txt"}`;
}

/** Render mermaid SOURCE to an svg string, or null while loading / on a syntax
 *  error. mermaid is imported lazily: it is the heaviest thing on this page and
 *  most rounds carry no diagram at all. */
function useMermaidSvg(mockup: GapMockup, index: number): string | null {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (mockup.format !== "mermaid") {
      return;
    }
    let live = true;

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // No foreignObject labels: the frame renders fine either way, but plain
          // <text> survives the svg sanitizer, and foreignObject does not.
          flowchart: { htmlLabels: false },
        });
        const rendered = await mermaid.render(
          `mockup-${index}`,
          mockup.markup.trim(),
        );

        if (live) {
          setSvg(rendered.svg);
        }
      } catch {
        // A diagram that will not parse is not worth failing the round over — the
        // author still has every section, and the figure says what happened.
        if (live) {
          setSvg("");
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [mockup.format, mockup.markup, index]);

  return svg;
}

function MockupFigure({
  mockup,
  index,
  stylesheet,
}: {
  mockup: GapMockup;
  index: number;
  stylesheet?: string;
}) {
  const mermaidSvg = useMermaidSvg(mockup, index);
  const isMermaid = mockup.format === "mermaid";
  const isHtml = mockup.format === "html";
  const raw = isMermaid ? (mermaidSvg ?? "") : mockup.markup;
  const clean = DOMPurify.sanitize(raw, isHtml ? HTML_CONFIG : SVG_CONFIG);
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(mockup.markup)}`;

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
        <a href={href} download={downloadName(mockup, index)} className="meta">
          download ↓
        </a>
      </figcaption>
      {isMermaid && mermaidSvg === null ? (
        <div className="meta">rendering diagram…</div>
      ) : (
        <iframe
          // No allow-scripts and no allow-same-origin: the frame can paint and
          // nothing else. It therefore cannot measure itself, which is why an html
          // mockup declares the height it needs.
          sandbox=""
          srcDoc={mockupFrameSrcdoc(clean, stylesheet)}
          title={mockup.title || `Mockup ${index + 1}`}
          height={mockupHeight(mockup)}
          style={{
            width: "100%",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "block",
          }}
        />
      )}
    </figure>
  );
}

export default function MockupSection({
  mockups,
  stylesheet,
}: {
  mockups: GapMockup[];
  stylesheet?: string;
}) {
  return (
    <div>
      {mockups.map((m, i) => (
        <MockupFigure key={i} mockup={m} index={i} stylesheet={stylesheet} />
      ))}
    </div>
  );
}
