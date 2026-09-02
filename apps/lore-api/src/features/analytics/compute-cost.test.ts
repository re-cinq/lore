import { describe, it, expect } from "vitest";
import {
  parseCpuCores,
  parseMemGib,
  podHourlyUsd,
  ratesFromEnv,
  spendInterval,
  DEFAULT_POD_PROFILE,
} from "./compute-cost.js";

describe("ratesFromEnv", () => {
  it("reads the env overrides and falls back to the documented e2 on-demand ballpark", () => {
    expect(ratesFromEnv({})).toEqual({
      cpuHourUsd: 0.022,
      memGibHourUsd: 0.003,
    });
    expect(
      ratesFromEnv({
        LORE_GKE_CPU_HOUR_USD: "0.05",
        LORE_GKE_MEM_GIB_HOUR_USD: "0.004",
      }),
    ).toEqual({ cpuHourUsd: 0.05, memGibHourUsd: 0.004 });
  });

  it("ignores an unparseable override rather than pricing at NaN", () => {
    expect(ratesFromEnv({ LORE_GKE_CPU_HOUR_USD: "free" })).toEqual({
      cpuHourUsd: 0.022,
      memGibHourUsd: 0.003,
    });
  });
});

describe("quantity parsing", () => {
  it("parses cores from millicores and whole cores", () => {
    expect(parseCpuCores("500m")).toBe(0.5);
    expect(parseCpuCores("2")).toBe(2);
    expect(parseCpuCores("1539m")).toBeCloseTo(1.539);
  });

  it("parses memory into GiB from Gi, Mi, G and M", () => {
    expect(parseMemGib("16Gi")).toBe(16);
    expect(parseMemGib("512Mi")).toBe(0.5);
    expect(parseMemGib("1G")).toBeCloseTo(0.9313, 3);
    expect(parseMemGib("128M")).toBeCloseTo(0.1192, 3);
  });

  it("treats an absent or malformed quantity as zero — a missing request costs the estimate nothing", () => {
    expect(parseCpuCores(undefined)).toBe(0);
    expect(parseCpuCores("lots")).toBe(0);
    expect(parseMemGib(undefined)).toBe(0);
    expect(parseMemGib("many")).toBe(0);
  });
});

describe("podHourlyUsd", () => {
  it("prices a pod's requests at the given rates", () => {
    const rates = { cpuHourUsd: 0.022, memGibHourUsd: 0.003 };

    expect(podHourlyUsd({ cpu: "1", memory: "16Gi" }, rates)).toBeCloseTo(
      0.022 + 16 * 0.003,
    );
    expect(podHourlyUsd({}, rates)).toBe(0);
  });

  it("the default profile prices a modest one-core pod, not a zero", () => {
    const rates = { cpuHourUsd: 0.022, memGibHourUsd: 0.003 };

    expect(podHourlyUsd(DEFAULT_POD_PROFILE, rates)).toBeGreaterThan(0);
  });
});

describe("spendInterval", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("defaults to the last 7 days ending today", () => {
    expect(spendInterval(undefined, undefined, now)).toEqual({
      from: "2026-08-26",
      to: "2026-09-02",
    });
  });

  it("accepts explicit ISO dates", () => {
    expect(spendInterval("2026-08-01", "2026-08-31", now)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("rejects a reversed interval, a malformed date and a span past 92 days", () => {
    expect(() => spendInterval("2026-08-31", "2026-08-01", now)).toThrow(
      "from must not be after to",
    );
    expect(() => spendInterval("yesterday", undefined, now)).toThrow(
      "dates must be YYYY-MM-DD",
    );
    expect(() => spendInterval("2026-01-01", "2026-08-01", now)).toThrow(
      "interval must span at most 92 days",
    );
  });
});
