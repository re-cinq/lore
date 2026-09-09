/** What the reaper needs to know about a prunable object, and the cluster surface it prunes through — a contract `outbound` implements (kube-pruner) and `work/reap` consumes, so it belongs to neither of them. */

export interface PrunableAgent {
  name: string;
  /** `Succeeded` / `Failed` once terminal; absent while the controller has not stamped it (what a crashlooping controller leaves). */
  phase?: string;
  createdAt: Date;
  /** The Station the run named, which is the clone it would orphan. */
  stationRef?: string;
}

export interface PrunableRecipe {
  name: string;
  createdAt: Date;
}

export interface PruneCluster {
  listAgents(): Promise<PrunableAgent[]>;
  listStations(): Promise<PrunableRecipe[]>;
  listDefinitions(): Promise<PrunableRecipe[]>;
  deleteAgent(name: string): Promise<void>;
  deleteStation(name: string): Promise<void>;
  deleteDefinition(name: string): Promise<void>;
  deleteSecretKey(key: string): Promise<void>;
}
