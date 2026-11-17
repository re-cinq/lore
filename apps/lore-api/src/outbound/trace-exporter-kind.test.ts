import { describe, expect, it } from "vitest";
import { traceExporterKind } from "./trace-exporter-kind.js";

describe("traceExporterKind", () => {
  it("returns cloud-trace when no variable is set", () => {
    expect(traceExporterKind({})).toBe("cloud-trace");
  });

  it("returns otlp when OTEL_EXPORTER_OTLP_ENDPOINT is http://collector:4318", () => {
    expect(
      traceExporterKind({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      }),
    ).toBe("otlp");
  });

  it("returns otlp when only OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is set", () => {
    expect(
      traceExporterKind({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector:4318/v1/traces",
      }),
    ).toBe("otlp");
  });

  it("returns cloud-trace when the OTLP endpoint is an empty string", () => {
    expect(traceExporterKind({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })).toBe(
      "cloud-trace",
    );
  });

  it("returns none when LORE_TRACE_EXPORTER is none despite an OTLP endpoint", () => {
    expect(
      traceExporterKind({
        LORE_TRACE_EXPORTER: "none",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      }),
    ).toBe("none");
  });

  it("returns cloud-trace when LORE_TRACE_EXPORTER is cloud-trace despite an OTLP endpoint", () => {
    expect(
      traceExporterKind({
        LORE_TRACE_EXPORTER: "cloud-trace",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      }),
    ).toBe("cloud-trace");
  });

  it("returns otlp when LORE_TRACE_EXPORTER is otlp without an endpoint", () => {
    expect(traceExporterKind({ LORE_TRACE_EXPORTER: "otlp" })).toBe("otlp");
  });

  it("returns cloud-trace when LORE_TRACE_EXPORTER is an unknown word", () => {
    expect(traceExporterKind({ LORE_TRACE_EXPORTER: "jaeger" })).toBe(
      "cloud-trace",
    );
  });
});
