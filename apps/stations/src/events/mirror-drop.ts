// A repository another repo publishes to does no work here: its events are finished unanswered (specs/public-mirror).
import { eventRepo } from "@re-cinq/lore-shared";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { Station } from "../domain/station.js";

/** The private repo that names this repository as its public mirror, or null. */
export type MirrorOwnerOf = (repo: string) => Promise<string | null>;

type DropLog = (line: string) => void;

/** A push to a branch of a public mirror, with the private repo that owns it. */
export interface MirrorPush {
  owner: string;
  mirror: string;
  branch: string | undefined;
}

export type MirrorPushHandler = (push: MirrorPush) => Promise<void>;

const RENAMED = "github.repository.renamed";
const PUSH = "github.push";

interface MirrorDrop {
  ownerOf: MirrorOwnerOf;
  log: DropLog;
  onMirrorPush?: MirrorPushHandler;
}

/** The rename of a mirror must reach its handler: it repoints the private repo's `public_mirror`. A push to the mirror goes to `onMirrorPush` when one is given, which brings its commits back to the owner. */
export function withMirrorDrop(
  handlers: Map<string, EventHandler>,
  ownerOf: MirrorOwnerOf,
  log: DropLog = console.log,
  onMirrorPush?: MirrorPushHandler,
): Map<string, EventHandler> {
  const drop = { ownerOf, log, onMirrorPush };

  return new Map(
    [...handlers].map(([eventName, handler]) => [
      eventName,
      eventName === RENAMED
        ? handler
        : droppingMirror(eventName, handler, drop),
    ]),
  );
}

function droppingMirror(
  eventName: string,
  handler: EventHandler,
  drop: MirrorDrop,
): EventHandler {
  return async (params, meta) => {
    const repo = eventRepo(params);
    const owner = repo === null ? null : await drop.ownerOf(repo);

    if (repo === null || owner === null) {
      return handler(params, meta);
    }
    const branch = (params as { branch?: string }).branch;

    return eventName === PUSH && drop.onMirrorPush
      ? drop.onMirrorPush({ owner, mirror: repo, branch })
      : drop.log(
          `[stations] dropped ${eventName} for ${repo}: the public mirror of ${owner}`,
        );
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
