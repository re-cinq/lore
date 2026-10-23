// Here, not beside the route, because both sides need it: declared in the route file it forced `work` to import upward from `transport` for a type alone.

/** One station: run it, get its summary back. */
/** `params` is the request's JSON body: what an operator asks a sweep, such as `{ "repo": "re-cinq/lore", "weeks": 8 }`. */
export type Station = (
  params: Readonly<Record<string, unknown>>,
) => Promise<string>;

export type StationRegistry = ReadonlyMap<string, Station>;
