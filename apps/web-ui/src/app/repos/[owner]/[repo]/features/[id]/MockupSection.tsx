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

/** Renders one mermaid diagram to SVG. Returns EMPTY rather than the markup when a script tag survives: a mockup is author-supplied text rendered into a frame, and framing a potentially escaped script is worse than showing no diagram. */
async function renderMermaid(markup: string, index: number): Promise<string> {
  const mermaid = (await import("mermaid")).default;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // Flowchart-only; ER and edge labels are foreignObject HTML, so MOCKUP_SVG_CONFIG would have to allow the tag.
    flowchart: { htmlLabels: false },
  });
  const rendered = await mermaid.render(`mockup-${index}`, markup.trim());

  return /<script/i.test(rendered.svg) ? "" : rendered.svg;
}

function useMermaidSvg(mockup: GapMockup, index: number): string | null {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (mockup.format !== "mermaid") {
      return;
    }
    let live = true;

    void (async () => {
      try {
        const svgMarkup = await renderMermaid(mockup.markup, index);

        // `live` flips to false from the cleanup below, across an async boundary the type checker can't see.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (live) {
          setSvg(svgMarkup);
        }
      } catch {
        // Parse failure does not fail the round; the author still has every section.
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

interface MockupFrameProps {
  isMermaid: boolean;
  mermaidSvg: string | null;
  clean: string;
  stylesheet?: string;
  mockup: GapMockup;
  index: number;
}

function MockupFrame({
  isMermaid,
  mermaidSvg,
  clean,
  stylesheet,
  mockup,
  index,
}: MockupFrameProps) {
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

/** The markup this figure may safely render. Mermaid output skips DOMPurify because purifying would strip its foreignObject — it is protected instead by mermaid's own securityLevel:"strict" plus the sandboxed frame, while AUTHOR markup is always purified. Empty until the browser takes over: the server renders with no `sanitize`, and useSyncExternalStore resolves that disagreement without a hydration mismatch. */
function useMockupMarkup(mockup: GapMockup, index: number) {
  const mermaidSvg = useMermaidSvg(mockup, index);
  const isMermaid = mockup.format === "mermaid";
  const isHtml = mockup.format === "html";
  const isBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  if (!isBrowser) {
    return { mermaidSvg, isMermaid, clean: "" };
  }

  return {
    mermaidSvg,
    isMermaid,
    clean: isMermaid
      ? (mermaidSvg ?? "")
      : sanitizeMockupMarkup(
          DOMPurify,
          mockup.markup,
          isHtml ? MOCKUP_HTML_CONFIG : MOCKUP_SVG_CONFIG,
        ),
  };
}

/** The mockup's title and a download link for its source. The markup is offered as a data URI because the frame is sandboxed with no scripts — there is no way for the frame itself to hand its contents back. */
function MockupCaption({
  mockup,
  index,
}: {
  mockup: GapMockup;
  index: number;
}) {
  return (
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
      <a
        href={`data:text/plain;charset=utf-8,${encodeURIComponent(mockup.markup)}`}
        download={downloadName(mockup, index)}
        className="meta"
      >
        download ↓
      </a>
    </figcaption>
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
  const { mermaidSvg, isMermaid, clean } = useMockupMarkup(mockup, index);

  return (
    <figure style={{ margin: "0 0 12px" }}>
      <MockupCaption mockup={mockup} index={index} />
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
