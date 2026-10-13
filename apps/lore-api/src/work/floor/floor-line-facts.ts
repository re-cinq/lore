// What a run's line version says about its nodes, read once per version (a version is its content): the graph the page draws with what each station does, each human station's route template, and the event that starts each node.
import type { FloorClient, LineBody, RunView } from "@re-cinq/floor-client";
import type {
  RunGraph,
  RunGraphNode,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  lineBodyToRunGraph,
  type StationKindName,
} from "./floor-run-mapping.js";

export type LineSource = Pick<FloorClient, "lines" | "stations">;

export interface LineFacts {
  graph: RunGraph;
  /** nodeId → the route template its station declares; only human stations name one. */
  routes: Record<string, string>;
  /** nodeId → the event that starts it: its `start:`, else `node.<id>.start`. */
  startEvents: Record<string, string>;
}

interface StationFacts {
  kind: StationKindName;
  route?: string;
  description?: string;
}

export async function readLineFacts(
  floor: LineSource,
  run: RunView,
): Promise<LineFacts> {
  const version = await floor.lines.version(run.lineId, run.lineHash);
  const body: LineBody = version?.body ?? emptyLine();
  const stations = await stationFactsOf(floor, body);

  return {
    graph: describedGraph(
      lineBodyToRunGraph(run.lineId, body, kindsOf(stations)),
      body,
      stations,
    ),
    routes: routesOf(body, stations),
    startEvents: startEventsOf(body),
  };
}

function startEventsOf(body: LineBody): Record<string, string> {
  return Object.fromEntries(
    body.nodes.map((node) => [node.id, node.start ?? `node.${node.id}.start`]),
  );
}

/** Each node with what its station does, the run graph's tooltip; a marker, and a station that says nothing, get none. */
function describedGraph(
  graph: RunGraph,
  body: LineBody,
  stations: Record<string, StationFacts>,
): RunGraph {
  const stationOf = new Map(body.nodes.map((node) => [node.id, node.station]));

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      ...descriptionOf(stationOf.get(node.id), stations),
    })),
  };
}

function descriptionOf(
  station: string | undefined,
  stations: Record<string, StationFacts>,
): Pick<RunGraphNode, "description"> {
  const facts: StationFacts | undefined =
    station === undefined ? undefined : stations[stationNameOf(station)];
  const description = facts?.description;

  return description === undefined ? {} : { description };
}

async function stationFactsOf(
  floor: LineSource,
  body: LineBody,
): Promise<Record<string, StationFacts>> {
  const names = body.nodes.flatMap((node) =>
    node.station ? [stationNameOf(node.station)] : [],
  );
  const stations = await Promise.all(
    names.map((name) => floor.stations.get(name)),
  );

  return Object.fromEntries(
    stations.flatMap((station) =>
      station ? [[station.id, factsOf(station.body)]] : [],
    ),
  );
}

function kindsOf(
  stations: Record<string, StationFacts>,
): Record<string, StationKindName> {
  return Object.fromEntries(
    Object.entries(stations).map(([name, facts]) => [name, facts.kind]),
  );
}

function routesOf(
  body: LineBody,
  stations: Record<string, StationFacts>,
): Record<string, string> {
  return Object.fromEntries(
    body.nodes.flatMap((node) => {
      const facts: StationFacts | undefined = node.station
        ? stations[stationNameOf(node.station)]
        : undefined;
      const route = facts?.route;

      return route === undefined ? [] : [[node.id, route]];
    }),
  );
}

// A human station that produces something is where a person writes what the line runs on.
function factsOf(body: {
  kind: "agent" | "service" | "human";
  produces?: readonly unknown[];
  route?: string;
  description?: string;
}): StationFacts {
  const kind =
    body.kind === "human" && (body.produces?.length ?? 0) > 0
      ? "author"
      : body.kind;

  return {
    kind,
    ...definedOf({ route: body.route, description: body.description }),
  };
}

/** The fields that are set, so a station that names no route or description carries no key for it. */
function definedOf(
  fields: Record<"route" | "description", string | undefined>,
): Pick<StationFacts, "route" | "description"> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

/** A node may pin its station as `name@hash`. */
function stationNameOf(stationRef: string): string {
  return stationRef.split("@")[0];
}

function emptyLine(): LineBody {
  return { entry: "", exit: "", args: {}, nodes: [], edges: [] };
}
