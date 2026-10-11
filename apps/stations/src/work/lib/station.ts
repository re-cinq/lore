/** What a station is and how work reaches it (ADR-031 D6/D7). */

import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";
import type {
  CostPort,
  GcpCostPort,
} from "@re-cinq/lore-shared/project/cost/cost-port.js";

/** The bus delivers these names to this station's subscriber. */
export interface EventTrigger {
  kind: "event";
  eventNames: readonly string[];
}

/** A schedule trigger. */
export interface CronTrigger {
  kind: "cron";
  schedule: string;
}

/** `POST /api/stations/<name>` — a caller with a synchronous question. */
export interface HttpTrigger {
  kind: "http";
}

export type StationTrigger = EventTrigger | CronTrigger | HttpTrigger;

/** The ports a station may ask its host for. */
export type StationPortName = keyof StationHost;

export interface StationManifest {
  /** The folder name, the registry key, and the URL segment. One string. */
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly StationTrigger[];
  /** Host ports this station requires. */
  readonly requires?: readonly StationPortName[];
}

/** True when this host serves every port the station asks for. */
export const hostCanRun = (
  manifest: StationManifest,
  served: readonly StationPortName[],
): boolean => (manifest.requires ?? []).every((p) => served.includes(p));

/** Facade over host capabilities, narrowly scoped to what stations actually use. */
export interface StationHost {
  /** The per-repo surface a sweep acts through. */
  repoFor(repo: string): Promise<StationRepo>;
  /** memory.* lifecycle: expiry, decay, consolidation. */
  memoryLifecycle(): MemoryLifecyclePort;
  /** pipeline.anthropic_cost_daily, for the cost import. */
  cost(): CostPort;
  /** pipeline.gcp_cost_daily, for the GCP billing import. */
  gcpCost(): GcpCostPort;
}

/** What a sweep may do to one repo. */
export interface StationRepo {
  labelsOn(issueNumber: number): Promise<string[]>;
  approve(taskId: string): Promise<void>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
  comment(issueNumber: number, body: string): Promise<void>;
}

/** Why a sweep ran, and what it reaches data through. */
export interface SweepContext {
  readonly trigger: "cron" | "event" | "http";
  /** The delivered event, on an event trigger. */
  readonly event?: {
    readonly name: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly eventId: string;
  };
  readonly host: StationHost;
}

/** Standalone work: the service contract, unchanged but for knowing why it ran. */
export type SweepStationRun = (ctx: SweepContext) => Promise<string>;

export interface SweepStationModule {
  readonly manifest: StationManifest;
  readonly run: SweepStationRun;
}

export type StationModule = SweepStationModule;

/** The event names a manifest's event triggers subscribe to, if any. */
export const eventTriggerNames = (manifest: StationManifest): string[] => {
  const events = manifest.triggers.filter(
    (t): t is EventTrigger => t.kind === "event",
  );

  return events.flatMap((t) => t.eventNames);
};

/** A port this host does not serve. */
export const unsupportedPort = (port: string, host: string): (() => never) => {
  return () => {
    throw new Error(
      `station port "${port}" is not served by the ${host} host — a station needing it must run somewhere that has it`,
    );
  };
};
