/** The `offset` query parameter of a load-more request: absent, negative or unparseable all read as the first page rather than as an error. */
export function pageOffsetParam(searchParams: URLSearchParams): number {
  return Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
}
