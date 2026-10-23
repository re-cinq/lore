export interface RunsQuery {
  /** `owner/name` of the one repository the list is filtered to. */
  repo?: string;
  status?: string;
  cursor?: string;
}

const RUNS_PATH = "/assembly-runs";

/** The run list's address at a query; a filter left out is not in the URL. */
export function runsHref(query: RunsQuery): string {
  const params = new URLSearchParams();

  for (const [name, value] of Object.entries(query)) {
    if (value) {
      params.set(name, value);
    }
  }

  return params.size > 0 ? `${RUNS_PATH}?${params}` : RUNS_PATH;
}
