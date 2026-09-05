"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import type { GapMockup } from "@/lib/feature-types";
import {
  MOCKUP_HTML_CONFIG,
  MOCKUP_SVG_CONFIG,
  mermaidFrameHeight,
  mockupFrameSrcdoc,
  mockupHeight,
  sanitizeMockupMarkup,
} from "@/lib/mockup-frame";

// LLM-generated mockup markup: sandbox="" frame + DOMPurify + sanitizeGapResult on write path; never put markup outside the frame.

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

/** Lazily imported; never notifies — store IS "am I in a browser". */
const subscribeNever = () => () => {};

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
          // Flowchart-only; ER/edge labels are foreignObject HTML, so MOCKUP_SVG_CONFIG must allow the tag.
          flowchart: { htmlLabels: false },
        });
        const rendered = await mermaid.render(
          `mockup-${index}`,
          mockup.markup.trim(),
        );

        // `live` flips to false from the cleanup below, across an async boundary the type checker can't see.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (live) {
          // Tripwire for script tags: fail render rather than frame a potentially escaped script.
          setSvg(/<script/i.test(rendered.svg) ? "" : rendered.svg);
        }
      } catch {
        // Parse failure does not fail the round; author still has all sections.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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

function mockupTitle(mockup: GapMockup, index: number): string {
  return mockup.title || `Mockup ${index + 1}`;
}

function frameHeight(
  isMermaid: boolean,
  mermaidSvg: string | null,
  mockup: GapMockup,
): number {
  const fromMermaid =
    isMermaid && mermaidSvg ? mermaidFrameHeight(mermaidSvg) : null;

  return fromMermaid ?? mockupHeight(mockup);
}

function MockupFrame({
  isMermaid,
  mermaidSvg,
  clean,
  stylesheet,
  mockup,
  index,
}: {
  isMermaid: boolean;
  mermaidSvg: string | null;
  clean: string;
  stylesheet?: string;
  mockup: GapMockup;
  index: number;
}) {
  if (isMermaid && mermaidSvg === null) {
    return <div className="meta">rendering diagram…</div>;
  }

  return (
    <iframe
      // No allow-scripts/same-origin; frame cannot measure itself, so html mockup declares height.
      sandbox=""
      srcDoc={mockupFrameSrcdoc(clean, stylesheet)}
      title={mockupTitle(mockup, index)}
      height={frameHeight(isMermaid, mermaidSvg, mockup)}
      style={{
        width: "100%",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        display: "block",
      }}
    />
  );
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
  // Server renders with no `sanitize` on DOMPurify; useSyncExternalStore handles the disagreement without hydration mismatch.
  const isBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  // Mermaid-rendered SVG: no DOMPurify (would strip foreignObject); two boundaries are mermaid's securityLevel:"strict" + sandbox; author markup still purified.
  const cleanMarkup = () => {
    if (!isBrowser) {
      return "";
    }

    if (isMermaid) {
      return mermaidSvg ?? "";
    }

    return sanitizeMockupMarkup(
      DOMPurify,
      mockup.markup,
      isHtml ? MOCKUP_HTML_CONFIG : MOCKUP_SVG_CONFIG,
    );
  };
  const clean = cleanMarkup();
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
        <span>{mockupTitle(mockup, index)}</span>
        <a href={href} download={downloadName(mockup, index)} className="meta">
          download ↓
        </a>
      </figcaption>
      <MockupFrame
        isMermaid={isMermaid}
        mermaidSvg={mermaidSvg}
        clean={clean}
        stylesheet={stylesheet}
        mockup={mockup}
        index={index}
      />
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
