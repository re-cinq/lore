/** What a station is and how work reaches it (ADR-031 D6/D7). */

import type {
  EdgeConditionValue,
  NodeTypeValue,
} from "@re-cinq/lore-assembly-lines";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";
import type {
  CostPort,
  GcpCostPort,
} from "@re-cinq/lore-shared/project/cost/cost-port.js";

/** Where a node station's work physically runs. */
export type StationRuntime =
  /** Its own short-lived pod: isolation, a workspace clone, a deadline, an identity. */
  | "pod"
  /** The pooled service: no pod per visit, for work that needs none of the above. */
  | "service";

/** An assembly-line node of this type dispatches here. */
export interface NodeTrigger {
  kind: "node";
  nodeType: NodeTypeValue;
  runtime: StationRuntime;
  /** Selects among several jobs behind one node type (the `detect` shape). */
  jobRef?: string;
  /** Needs the branch checked out. Only a pod can provide one. */
  clone?: boolean;
  /** What the walk must route. Mirrors PRODUCIBLE_OUTCOMES for this type. */
  outcomes: readonly EdgeConditionValue[];
  timeoutMinutes: number;
}

/** A human approves work; the run parks until then. */
export interface HumanTrigger {
  kind: "human";
  nodeType: NodeTypeValue;
}

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

export type StationTrigger =
  NodeTrigger | HumanTrigger | EventTrigger | CronTrigger | HttpTrigger;

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

/** Everything a pod station is given beyond its input. */
export interface StationEnv {
  workspaceDir: string;
}

/** Facade over host capabilities, narrowly scoped to what stations actually use. */
export interface StationHost {
  /** Tasks parked on a human approving their issue. */
  awaitingApproval(): Promise<
    Array<{ id: string; target_repo: string; issue_number: number }>
  >;
  /** The label that counts as approval, per configuration. */
  approvalLabel(): string;
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

/** One visit to a node: the pod contract, unchanged. */
export type NodeStationRun = (
  input: StationInput,
  env: StationEnv,
) => Promise<NodeResult>;

/** Standalone work: the service contract, unchanged but for knowing why it ran. */
export type SweepStationRun = (ctx: SweepContext) => Promise<string>;

export interface NodeStationModule {
  readonly manifest: StationManifest;
  readonly run: NodeStationRun;
}

export interface SweepStationModule {
  readonly manifest: StationManifest;
  readonly run: SweepStationRun;
}

/** A station whose worker is a person: a manifest and nothing to run. */
export interface HumanStationModule {
  readonly manifest: StationManifest;
}

/** Union of sweep and HTTP handler run shapes. */
export type StationModule =
  NodeStationModule | SweepStationModule | HumanStationModule;

/** The node triggers a manifest declares, if any. */
export const nodeTriggers = (manifest: StationManifest): NodeTrigger[] =>
  manifest.triggers.filter((t): t is NodeTrigger => t.kind === "node");

/** The event names a manifest's event triggers subscribe to, if any. */
export const eventTriggerNames = (manifest: StationManifest): string[] =>
  manifest.triggers
    .filter((t): t is EventTrigger => t.kind === "event")
    .flatMap((t) => t.eventNames);

/** True when the module can actually run a node visit. */
export const isNodeModule = (mod: StationModule): mod is NodeStationModule =>
  "run" in mod && nodeTriggers(mod.manifest).length > 0;

/** True when the module runs standalone work rather than a node visit. */
export const isSweepModule = (mod: StationModule): mod is SweepStationModule =>
  "run" in mod && nodeTriggers(mod.manifest).length === 0;

/** A port this host does not serve. */
export const unsupportedPort = (port: string, host: string): (() => never) => {
  return () => {
    throw new Error(
      `station port "${port}" is not served by the ${host} host — a station needing it must run somewhere that has it`,
    );
  };
};
