// A repository another repo publishes to does no work here: its events are finished unanswered (specs/public-mirror).
import { eventRepo } from "@re-cinq/lore-shared";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { Station } from "../domain/station.js";

/** The private repo that names this repository as its public mirror, or null. */
export type MirrorOwnerOf = (repo: string) => Promise<string | null>;

type DropLog = (line: string) => void;

const RENAMED = "github.repository.renamed";

/** The rename of a mirror must reach its handler: it repoints the private repo's `public_mirror`. */
export function withMirrorDrop(
  handlers: Map<string, EventHandler>,
  ownerOf: MirrorOwnerOf,
  log: DropLog = console.log,
): Map<string, EventHandler> {
  return new Map(
    [...handlers].map(([eventName, handler]) => [
      eventName,
      eventName === RENAMED
        ? handler
        : droppingMirror(eventName, handler, ownerOf, log),
    ]),
  );
}

function droppingMirror(
  eventName: string,
  handler: EventHandler,
  ownerOf: MirrorOwnerOf,
  log: DropLog,
): EventHandler {
  return async (params, meta) => {
    const repo = eventRepo(params);
    const owner = repo === null ? null : await ownerOf(repo);

    if (owner !== null) {
      log(
        `[stations] dropped ${eventName} for ${repo}: the public mirror of ${owner}`,
      );

      return;
    }
    await handler(params, meta);
  };
}

/** The same guard for a sweep an operator or a courier posts to by HTTP with a repo in its body. */
export function withMirrorDropStations(
  stations: ReadonlyMap<string, Station>,
  ownerOf: MirrorOwnerOf,
  log: DropLog = console.log,
): ReadonlyMap<string, Station> {
  return new Map(
    [...stations].map(([name, station]) => [
      name,
      stationDroppingMirror(name, station, ownerOf, log),
    ]),
  );
}

function stationDroppingMirror(
  name: string,
  station: Station,
  ownerOf: MirrorOwnerOf,
  log: DropLog,
): Station {
  return async (params) => {
    const repo = eventRepo({ ...params });
    const owner = repo === null ? null : await ownerOf(repo);

    if (owner === null) {
      return station(params);
    }
    log(
      `[stations] dropped station ${name} for ${repo}: the public mirror of ${owner}`,
    );

    return `dropped: ${repo} is the public mirror of ${owner}`;
  };
}
