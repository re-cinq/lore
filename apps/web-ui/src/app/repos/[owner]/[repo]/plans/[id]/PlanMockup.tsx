"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import {
  DEFAULT_MOCKUP_HEIGHT,
  MOCKUP_HTML_CONFIG,
  MOCKUP_SVG_CONFIG,
  mermaidFrameHeight,
  mockupFrameSrcdoc,
  mockupHeight,
  sanitizeMockupMarkup,
} from "@/lib/mockup-frame";
import type { Mockup } from "@re-cinq/planning-editor";
import styles from "./PlanMockup.module.scss";

interface SketchProps {
  markup: string;
  title: string;
  height: number;
}

export default function PlanMockup(props: Mockup) {
  const sketch = {
    markup: props.markup,
    title: props.caption || "Sketch",
    height: props.height,
  };
  const Sketch = SKETCHES[props.format] ?? TextSketch;

  return <Sketch {...sketch} />;
}

function HtmlSketch({ markup, title, height }: SketchProps) {
  const clean = useIsBrowser()
    ? sanitizeMockupMarkup(DOMPurify, markup, MOCKUP_HTML_CONFIG)
    : "";

  return (
    <SketchFrame markup={clean} title={title} height={mockupHeight(height)} />
  );
}

function SvgSketch({ markup }: SketchProps) {
  const clean = useIsBrowser()
    ? sanitizeMockupMarkup(DOMPurify, markup, MOCKUP_SVG_CONFIG)
    : "";

  return (
    <div className={styles.svg} dangerouslySetInnerHTML={{ __html: clean }} />
  );
}

function TextSketch({ markup }: SketchProps) {
  return <pre className={styles.text}>{markup}</pre>;
}

function MermaidSketch({ markup, title }: SketchProps) {
  const drawn = useMermaidSvg(markup);

  if (drawn === undefined) {
    return <p className={styles.note}>Drawing the sketch…</p>;
  }

  if (drawn === null) {
    return <UndrawnSketch markup={markup} />;
  }

  return (
    <SketchFrame
      markup={drawn}
      title={title}
      height={mermaidFrameHeight(drawn) ?? DEFAULT_MOCKUP_HEIGHT}
    />
  );
}

function UndrawnSketch({ markup }: { markup: string }) {
  return (
    <div className={styles.note}>
      <p>This sketch could not be drawn.</p>
      <details>
        <summary>Source</summary>
        <pre className={styles.text}>{markup}</pre>
      </details>
    </div>
  );
}

const SKETCHES: Record<string, (props: SketchProps) => React.ReactNode> = {
  html: HtmlSketch,
  svg: SvgSketch,
  mermaid: MermaidSketch,
  text: TextSketch,
};

interface MermaidOutcome {
  source: string;
  svg: string | null;
}

/** undefined while drawing, null when the diagram could not be drawn; an outcome for older markup is never shown. */
function useMermaidSvg(markup: string): string | null | undefined {
  const diagramId = `sketch-${useId().replace(/[^\w-]/g, "")}`;
  const [outcome, setOutcome] = useState<MermaidOutcome>();

  useEffect(() => {
    const request = { live: true };

    void renderMermaid(diagramId, markup).then((svg) => {
      if (request.live) {
        setOutcome({ source: markup, svg });
      }
    });

    return () => {
      request.live = false;
    };
  }, [diagramId, markup]);

  return outcome?.source === markup ? outcome.svg : undefined;
}

let mermaidModule: Promise<typeof import("mermaid")> | undefined;

/** A rendered svg that still holds a script is dropped: mermaid's output is framed unsanitized, since purifying would strip its labels. */
async function renderMermaid(
  id: string,
  markup: string,
): Promise<string | null> {
  mermaidModule ??= import("mermaid");
  const mermaid = (await mermaidModule).default;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    flowchart: { htmlLabels: false },
  });
  const rendered = await mermaid.render(id, markup.trim()).catch(() => null);

  return rendered && !/<script/i.test(rendered.svg) ? rendered.svg : null;
}

const subscribeNever = () => () => {};

function useIsBrowser(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function SketchFrame({ markup, title, height }: SketchProps) {
  return (
    <iframe
      className={styles.frame}
      sandbox=""
      srcDoc={mockupFrameSrcdoc(markup)}
      title={title}
      height={height}
    />
  );
}
