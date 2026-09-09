// Here, not beside the route, because both sides need it: declared in the route file it forced `work` to import upward from `transport` for a type alone.

/** One station: run it, get its summary back. */
export type Station = () => Promise<string>;

export type StationRegistry = ReadonlyMap<string, Station>;
