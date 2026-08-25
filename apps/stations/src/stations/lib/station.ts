/**
 * What a station is, and how work reaches it.
 *
 * "Station" named three unrelated things in three homes, with three registries —
 * two of them sharing a byte-identical signature and knowing nothing about each
 * other. This is the one declaration they collapse into: a manifest saying what
 * the station is triggered by, paired with the handler shape that trigger
 * implies.
 *
 * Deliberately dependency-light. This package is imported by BOTH runtimes — the
 * long-lived service that holds a pool and a GitHub App, and the one-shot pod
 * that holds neither credential (ADR-031 D6/D7) — so nothing here may reach for
 * a database, a client, or a credential. A station that needs data is GIVEN it.
 *
 * It lives in `apps/stations` — the app that RUNS the stations — and both the
 * Floor and lore-api import it from there. That inverts the usual deployable
 * boundary, and it is a known debt rather than a design: an app importing
 * another app resolves only because npm hoists the workspace.
 *
 * It is survivable today because of what actually crosses. The Floor reads
 * `.manifest` and never a handler — a node's runtime and its timeout budget —
 * so nothing about a station's implementation reaches it. lore-api is the real
 * offender: its maintenance route still CALLS `.run`, which is the leftover the
 * cutover meant to remove.
 *
 * The fix, when it is taken, is the split the plan named: manifests reachable
 * from a lib, handlers staying in their station's folder here. It is not taken
 * yet because it separates a station's manifest from its folder, and one folder
 * per station is the property this consolidation exists to give.
 *
 * (Nothing here may reach for a database, a client, or a credential regardless:
 * this file is imported by BOTH runtimes, the long-lived service that holds a
 * pool and a GitHub App, and the one-shot pod that holds neither.)
 */

import type {
  EdgeConditionValue,
  NodeTypeValue,
} from "@re-cinq/lore-assembly-lines";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";
import type { CostPort } from "@re-cinq/lore-shared/project/cost/cost-port.js";

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

/**
 * A person does the work; the run parks until that person reports.
 *
 * No `route`. The page a run parks on belongs to the NODE: the YAML declares it
 * per node, the loader rejects a human node without one, it is snapshotted into
 * the run graph and resolved from that run's args by `resolveRoute`. A
 * station-level route would be a second declaration with no reader — `feature_review`
 * parks on the feature page and `pr_review` on `{args.pr_url}`, so the station
 * could not name one anyway.
 */
export interface HumanTrigger {
  kind: "human";
  nodeType: NodeTypeValue;
}

/** The bus delivers these names to this station's subscriber. */
export interface EventTrigger {
  kind: "event";
  eventNames: readonly string[];
}

/** A schedule. Sugar over an event trigger — the tick arrives on the bus like
 *  anything else — kept separate so the emitter set can be derived from it. */
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
  /**
   * The host ports this station reaches for.
   *
   * Declared so a host can expose exactly the stations it can actually RUN.
   * Without it, lore-api — which has a pool but no GitHub App — advertised a
   * repo sweep it could only fail, and the failure was reachable from the
   * outside rather than impossible.
   */
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

/**
 * The data a sweep reaches through, supplied by whichever process hosts it.
 *
 * A facade rather than each sweep importing kernel singletons: this package is
 * shared with a pod that has no pool, so a station that resolved its own
 * database could not live here at all. It is also what lets the sweeps be tested
 * without one.
 *
 * Narrow on purpose — it grows one method at a time, as a sweep needs it, so it
 * stays a description of what stations actually use rather than a mirror of the
 * host's whole surface.
 *
 * Not every host can serve every port, and that is fine: lore-api runs the
 * scheduled data operations and has no GitHub App, while the stations service
 * runs the repo sweeps. A host declares what it cannot serve with
 * {@link unsupportedPort}, so calling it fails by NAME at the call site rather
 * than as `undefined is not a function` — and a station only ever reaches for
 * what its own trigger implies it needs.
 */
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

/**
 * Merging the two run shapes would force every sweep to invent a NodeResult and
 * every node visit to invent a summary line. They stay distinct, and the union
 * is what the registry holds.
 */
export type StationModule =
  NodeStationModule | SweepStationModule | HumanStationModule;

/** The node triggers a manifest declares, if any. */
export const nodeTriggers = (manifest: StationManifest): NodeTrigger[] =>
  manifest.triggers.filter((t): t is NodeTrigger => t.kind === "node");

/** True when the module can actually run a node visit. */
export const isNodeModule = (mod: StationModule): mod is NodeStationModule =>
  "run" in mod && nodeTriggers(mod.manifest).length > 0;

/** True when the module runs standalone work rather than a node visit. */
export const isSweepModule = (mod: StationModule): mod is SweepStationModule =>
  "run" in mod && nodeTriggers(mod.manifest).length === 0;

/**
 * A port this host does not serve.
 *
 * Returns a function that throws when CALLED, naming both the port and the host,
 * rather than a cast that claims the host is something it is not. A station
 * reaching a port its host cannot serve is a wiring bug, and this is what makes
 * it say so.
 */
export const unsupportedPort = (port: string, host: string): (() => never) => {
  return () => {
    throw new Error(
      `station port "${port}" is not served by the ${host} host — a station needing it must run somewhere that has it`,
    );
  };
};
