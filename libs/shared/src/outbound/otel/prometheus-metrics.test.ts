import { afterEach, describe, expect, it } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  metricsPortFromEnv,
  startPrometheusMetrics,
} from "./prometheus-metrics.js";
import { recordStationRun } from "./metrics.js";

const PORT = 19464;

describe("startPrometheusMetrics", () => {
  afterEach(() => metrics.disable());

  it("serves lore_station_runs_total for station nightly-digest on the port it was given", async () => {
    const started = startPrometheusMetrics({
      serviceName: "lore-test",
      port: PORT,
    });

    recordStationRun({
      station: "nightly-digest",
      outcome: "success",
      durationMs: 5,
    });
    const body = await (
      await fetch(`http://127.0.0.1:${PORT}/metrics`, {
        signal: AbortSignal.timeout(5_000),
      })
    ).text();

    await started.stop();
    expect(body).toMatch(
      /lore_station_runs_total\{[^}]*station="nightly-digest"[^}]*\} 1/,
    );
    expect(body).toMatch(/lore_station_duration_ms_bucket\{/);
    expect(body).toContain('service_name="lore-test"');
  });

  it("reads 9500 from LORE_METRICS_PORT and falls back to 9464 without it", () => {
    expect(metricsPortFromEnv({ LORE_METRICS_PORT: "9500" })).toEqual(9500);
    expect(metricsPortFromEnv({})).toEqual(9464);
  });
});
