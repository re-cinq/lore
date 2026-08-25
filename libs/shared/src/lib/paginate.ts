/**
 * Walk a Kubernetes-style paginated list to the end.
 *
 * Three places had grown their own `do { … } while (continueToken)`: the
 * event-router's CR watch, the Floor's reconcile pass, and the cluster client's
 * `listByLabel`. They fetch differently — raw apiserver, HTTP through the
 * cluster agent, HTTP by label — but the loop is the same loop, and it is the
 * loop that has the bug in it. Forgetting to carry `continue` does not fail: it
 * returns the first page forever, or returns it once and calls that the answer.
 *
 * A one-shot list is deliberately not offered anywhere. 180 accumulated CRs at
 * ~1.4MB of status each in a single unpaginated LIST blew Node's heap and
 * crash-looped the Floor on 2026-07-24.
 */

export interface Page<T> {
  items: T[];
  continueToken?: string;
}

/** Fetch every page, handing each to `onPage` as it arrives. */
export async function forEachPage<T>(
  fetchPage: (continueToken?: string) => Promise<Page<T>>,
  onPage: (items: T[]) => Promise<void>,
): Promise<void> {
  let continueToken: string | undefined;

  do {
    const page = await fetchPage(continueToken);

    await onPage(page.items);
    continueToken = page.continueToken;
  } while (continueToken);
}

/** Fetch every page and return the items as one list. Only for a list whose
 *  size is bounded by what it selects — never for the whole namespace. */
export async function collectPages<T>(
  fetchPage: (continueToken?: string) => Promise<Page<T>>,
): Promise<T[]> {
  const all: T[] = [];

  await forEachPage(fetchPage, async (items) => {
    all.push(...items);
  });

  return all;
}
