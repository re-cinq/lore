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
 * It lives in a LIB rather than in either app because an app cannot import
 * another app, and one registry has to be reachable from both. (It does not, on
 * its own, slim the pod image: the scoped `npm ci` still installs the hoisted
 * root tree, so the pod ships pg and octokit it never uses either way. Keeping
 * this package free of them is what makes fixing that possible later.)
 */

import type {
  EdgeConditionValue,
  NodeTypeValue,
} from "@re-cinq/lore-assembly-lines";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

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

/** A person does the work; the run parks until the page at `route` reports. */
export interface HumanTrigger {
  kind: "human";
  nodeType: NodeTypeValue;
  route: string;
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

export interface StationManifest {
  /** The folder name, the registry key, and the URL segment. One string. */
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly StationTrigger[];
}

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
