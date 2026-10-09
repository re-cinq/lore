---
adr_number: 50
title: "Metrics go to Prometheus and Grafana, installed by terraform"
status: shipped
date: 2026-10-09
deciders: ["Bogdan Szabo"]
domains: [observability, infrastructure, terraform, lore-api, stations, floor, ai-agent-subsystem]
---

# ADR-050: Metrics go to Prometheus and Grafana, installed by terraform

This ADR records where Lore's numbers live and why: every service serves OpenTelemetry metrics as Prometheus text on its own port, a terraform-installed kube-prometheus-stack scrapes them together with the floor's and the agent controller's `/metrics`, and Grafana behind the Headlamp-style Google gate shows them on dashboards that are built once and name no assembly line.

## Context

Nothing answered "what is happening on the factory floor" as numbers. lore-api started an OpenTelemetry SDK that pushed metrics to Cloud Monitoring, which nobody opened; the stations service and the lore-mcp gateway started no SDK at all. The floor ([re-cinq/floor](https://github.com/re-cinq/floor)) and the ai-agent-subsystem controller each already served a hand-written Prometheus `/metrics`, but nothing scraped them.

Worse, lore-api's own counters had never recorded anything. The OpenTelemetry metrics API, unlike its tracing API, has no proxy meter: an instrument created from `metrics.getMeter()` before a `MeterProvider` is registered is a permanent no-op. `libs/server-core/src/outbound/otel.ts` created its instruments at import time, and the entrypoint imported it before `initOtel()` ran, so `lore.http.requests`, `lore.tool.calls` and the rest were dead from the day they were written.

Two Prometheus flavours were weighed. Google Managed Prometheus bills $0.06 per million samples, so it grows with every histogram and label a dashboard asks for. The self-hosted stack on Autopilot bills its pods' requests, about $27 a month, flat: 600m CPU and 1.7 GiB across Prometheus, its operator, kube-state-metrics, Grafana and an oauth2-proxy, plus a 10 Gi disk. GKE's own pod metrics stay free in Cloud Monitoring either way, so Grafana reads those through a Cloud Monitoring datasource.

## Decision

- **Instruments are resolved lazily, against the provider registered at record time.** `libs/shared/src/outbound/otel/metrics.ts` holds every Lore instrument and looks each up on the current global meter provider, memoized per provider, so a record made after a late registration lands and a record made on a laptop adapter that never registers one costs nothing.
  - A failed tool call counts as one call and one error. ([validated by counts a failed lore_search_context tool call as one call and one error](../libs/shared/src/outbound/otel/metrics.test.ts#L44))
  - A request's path is collapsed to its first segments with ids replaced, so a route is one series. ([validated by records GET /api/repos/<uuid>/x as GET /api/repos with status 200](../libs/shared/src/outbound/otel/metrics.test.ts#L161))
- **Every Lore service serves Prometheus text on a `metrics` port**, 9464 by default (`LORE_METRICS_PORT`), through `@opentelemetry/exporter-prometheus`: lore-api hands the reader to its NodeSDK beside the Cloud Trace exporter, which keeps traces; the stations service and the lore-mcp gateway register one MeterProvider of their own. The Cloud Monitoring metric exporter is gone. ([validated by serves lore_station_runs_total for station nightly-digest on the port it was given](../libs/shared/src/outbound/otel/prometheus-metrics.test.ts#L14), [validated by reads 9500 from LORE_METRICS_PORT and falls back to 9464 without it](../libs/shared/src/outbound/otel/prometheus-metrics.test.ts#L39))
- **Each thing worth counting is recorded at exactly one site.**
  - A service station's run and duration, by station and outcome, where the stations service runs any station by HTTP or from the bus. ([validated by counts a station run of pr-ready-check as success and records its duration](../libs/shared/src/outbound/otel/metrics.test.ts#L65), [validated by returns the summary of a run that resolves with 'swept 3'](../apps/stations/src/events/runner/timed-station-run.test.ts#L5), [validated by rethrows the error of a run that fails with 'pool closed'](../apps/stations/src/events/runner/timed-station-run.test.ts#L11))
  - A bus delivery's result in the shared drain loop. ([validated by counts a dead bus delivery of github.pull_request.opened](../libs/shared/src/outbound/otel/metrics.test.ts#L86))
  - The depth of the stations subscriber's queue, read from the deliveries port on every scrape. ([validated by counts 2 waiting deliveries for the stations subscriber after one of three is done](../libs/shared/src/outbound/project/events/event-deliveries-pending-count.test.ts#L5))
  - A start on the floor, by line and whether it joined an open run, in the one shared `startLine`. ([validated by counts a joined code-review start](../libs/shared/src/outbound/otel/metrics.test.ts#L97))
  - A GitHub delivery, by the bus event it became, in the webhook route. ([validated by counts a github.push webhook event](../libs/shared/src/outbound/otel/metrics.test.ts#L108))
- **Lore's own model calls are metered by decorating the usage sink**, so every provider is covered by one site: calls by provider, model and status; tokens by kind; computed cost in USD. ([validated by records a claude-sonnet call as 1 call, 300 input, 50 output tokens and 0.02 usd](../libs/shared/src/outbound/otel/metrics.test.ts#L119), [validated by writes the gemini-2.5-flash row through and counts one call of 10 input tokens](../libs/shared/src/outbound/project/usage/metered-usage.test.ts#L22))
- **Billed spend is a gauge read from the synced invoices**, `lore.billed.cost_usd` by vendor, item and window (today, month to date), from the same two daily tables `/spend` reads, so the two never disagree. ([validated by turns one anthropic row of 1.5 today and 20 this month into a day point and a month point](../apps/lore-api/src/outbound/billed-cost-gauge.test.ts#L5))

## Consequences

Applied on 2026-10-09 with `enable_monitoring = true` at `grafana.gcp.re-cinq.com`; the five dashboards opened populated on first login. Where the rest of the design lives:

**The floor and the agent controller keep their own `/metrics`** and are scraped as they are: the floor's numbers are fresh queries on every scrape (its rule, so two replicas agree), and the controller's are the module state of a D program with no OpenTelemetry SDK. Durations, outcomes and cost per line, station and model are added there in the same shape.

**terraform installs kube-prometheus-stack and Grafana behind `enable_monitoring`**, in a `monitoring` namespace, with node-exporter and the GKE-hidden control-plane targets off, PodMonitors and ServiceMonitors for every service, and Grafana behind oauth2-proxy with the same Google client as Headlamp. Grafana trusts the email header the proxy sets, which nginx overwrites on the way in, and a NetworkPolicy keeps in-cluster callers from forging it.

**No dashboard names an assembly line.** The per-line dashboard is one board whose `line` variable is read from the metric labels; a line added next month appears by itself.

- Cloud Monitoring holds no Lore metric any more; traces still go to Cloud Trace from lore-api.
- A new instrument goes into `metrics.ts` and is recorded from one site; a module-level `createCounter` anywhere else is the bug this ADR exists to name.
- The web UI links to Grafana only when terraform hands it `GRAFANA_URL`, as it does for Headlamp.
- The monitoring stack is applied by a person from `main`, after the services that feed it are live, so the first login opens populated dashboards.
