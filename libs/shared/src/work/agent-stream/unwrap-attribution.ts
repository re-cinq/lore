// TRANSITIONAL (delete once no pre-cutover CRs remain): peels the {"source":{...},"event":<line>} envelope pre-cutover CRs still wrap status.output in.
interface AttributedLine {
  source: unknown;
  event: unknown;
}

// Attribution envelope peeled off a subsystem line (event + source, null source when bare/non-object) — unwrap side for both the status.output read path and the NDJSON telemetry sink (POST /api/agent-events).
export function unwrapAttribution(value: unknown): {
  source: Record<string, unknown> | null;
  event: unknown;
} {
  if (!isAttributedLine(value)) {
    return { source: null, event: value };
  }

  const source = attributionSource(value.source);
  const event = value.event;

  // TRANSITIONAL, second peel only: prod double-wraps sink-lane lines ({source, event:{source, event}}), dropping the cost row without this (#875); remove once subsystem enforces single-wrap at source (subsystem#171 unverified) — bounded at two, a third layer is left intact.
  if (isAttributedLine(event)) {
    const inner = attributionSource(event.source);

    return {
      source: source || inner ? { ...inner, ...source } : null,
      event: event.event,
    };
  }

  return { source, event };
}

export function isAttributedLine(value: unknown): value is AttributedLine {
  return (
    typeof value === "object" &&
    value !== null &&
    "source" in value &&
    "event" in value
  );
}

function attributionSource(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
