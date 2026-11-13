import { z } from "zod";
import { errorMessage } from "@re-cinq/lore-shared";
import type { ServiceVersion } from "@re-cinq/lore-shared/models/service-version.js";

// GET /api/versions: which build of every Lore part runs. Each source answers alone, so one that fails shows its `{error}` and the rest still answer.

const ErrorSchema = z.object({ error: z.string() });
const orError = <T extends z.ZodType>(schema: T) =>
  z.union([schema, ErrorSchema]);
const Packages = z.record(z.string(), z.string());
const ServiceEntry = orError(
  z.object({ build: z.string(), startedAt: z.date(), packages: Packages }),
);
const UiEntry = orError(z.object({ build: z.string(), packages: Packages }));
// The floor lists its live clusters from a release this one may predate: read it defensively and keep what parses.
const ClusterSchema = z.object({
  id: z.string(),
  build: z.string().nullable(),
  subsystem: z.unknown().nullable(),
  lastSeenAt: z.string(),
});
const FloorEntry = orError(
  z.object({
    build: z.string(),
    schemaVersion: z.number(),
    clusters: z.array(ClusterSchema),
  }),
);
const DatabaseEntry = orError(
  z.object({
    migration: z.string().nullable(),
    floorMigration: z.string().nullable(),
  }),
);
const OnFloorEntry = orError(
  z.object({
    pipelines: z.array(
      z.object({ id: z.string(), hash: z.string().nullable() }),
    ),
    agentDefinitions: z.number(),
  }),
);

export const VersionsSchema = z.object({
  lore: z.object({
    "lore-api": ServiceEntry,
    stations: ServiceEntry,
    "lore-mcp": ServiceEntry,
    "lore-ui": UiEntry,
  }),
  latest: z.object({ build: z.string() }),
  floor: FloorEntry,
  database: DatabaseEntry,
  onFloor: OnFloorEntry,
  agentImage: z.string().nullable(),
});

export type Versions = z.infer<typeof VersionsSchema>;
type Failed = z.infer<typeof ErrorSchema>;
type Answered<Part> = Exclude<Part, Failed>;
type ServiceAnswer = Versions["lore"]["lore-api"];

export interface VersionSources {
  services(): Promise<ServiceVersion[]>;
  ui(): Promise<Answered<Versions["lore"]["lore-ui"]>>;
  /** The floor's raw `GET /version`. */
  floorVersion(): Promise<unknown>;
  migrations(): Promise<Answered<Versions["database"]>>;
  onFloor(): Promise<Answered<Versions["onFloor"]>>;
  env: Partial<Record<"LORE_BUILD_SHA" | "LORE_AGENT_IMAGE", string>>;
}

export async function versionsAnswer(
  sources: VersionSources,
): Promise<Versions> {
  const [services, ui, floor, database, onFloor] = await Promise.all([
    settled(sources.services),
    settled(sources.ui),
    settled(async () => floorOf(await sources.floorVersion())),
    settled(sources.migrations),
    settled(sources.onFloor),
  ]);

  return {
    lore: { ...loreServices(services), "lore-ui": ui },
    latest: { build: sources.env.LORE_BUILD_SHA || "dev" },
    floor,
    database,
    onFloor,
    agentImage: sources.env.LORE_AGENT_IMAGE || null,
  };
}

async function settled<T>(read: () => Promise<T>): Promise<T | Failed> {
  try {
    return await read();
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

function loreServices(
  rows: ServiceVersion[] | Failed,
): Record<"lore-api" | "stations" | "lore-mcp", ServiceAnswer> {
  const entryOf = (service: string): ServiceAnswer => {
    if ("error" in rows) {
      return rows;
    }
    const row = rows.find((candidate) => candidate.service === service);

    return row
      ? { build: row.build, startedAt: row.startedAt, packages: row.packages }
      : { error: "not reported" };
  };

  return {
    "lore-api": entryOf("lore-api"),
    stations: entryOf("stations"),
    "lore-mcp": entryOf("lore-mcp"),
  };
}

const FloorVersionWire = z.object({
  sha: z.string(),
  schemaVersion: z.number(),
  clusters: z.array(z.unknown()).optional(),
});

function floorOf(raw: unknown): Answered<Versions["floor"]> {
  const wire = FloorVersionWire.parse(raw);
  const clusters = (wire.clusters ?? []).flatMap((cluster) => {
    const parsed = ClusterSchema.safeParse(cluster);

    return parsed.success ? [parsed.data] : [];
  });

  return { build: wire.sha, schemaVersion: wire.schemaVersion, clusters };
}
