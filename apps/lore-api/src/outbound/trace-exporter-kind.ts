export type TraceExporterKind = "otlp" | "cloud-trace" | "none";

const EXPLICIT_KINDS: readonly TraceExporterKind[] = [
  "otlp",
  "cloud-trace",
  "none",
];

export function traceExporterKind(env: NodeJS.ProcessEnv): TraceExporterKind {
  const explicitKind = EXPLICIT_KINDS.find(
    (kind) => kind === env.LORE_TRACE_EXPORTER,
  );

  if (explicitKind) {
    return explicitKind;
  }

  const hasOtlpEndpoint = Boolean(
    env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  );

  return hasOtlpEndpoint ? "otlp" : "cloud-trace";
}
