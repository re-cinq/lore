/** Absent, empty and whitespace all mean "no dashboard deployed" — `reuse_values` makes the disabled case an empty string rather than a missing key. */
export function headlampUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.HEADLAMP_URL?.trim() || undefined;
}

/** The Grafana the monitoring stack publishes (ADR-050), under the same rule as the cluster dashboard. */
export function grafanaUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.GRAFANA_URL?.trim() || undefined;
}
