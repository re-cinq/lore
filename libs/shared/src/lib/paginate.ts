// Shared Kubernetes-style pagination loop (event-router watch, Floor reconcile, cluster client) — no one-shot list is offered: an unpaginated LIST of 180 CRs blew Node's heap and crash-looped the Floor on 2026-07-24.

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

/** Fetch every page and return the items as one list. Only for a list whose size is bounded by what it selects — never for the whole namespace. */
export async function collectPages<T>(
  fetchPage: (continueToken?: string) => Promise<Page<T>>,
): Promise<T[]> {
  const all: T[] = [];

  await forEachPage(fetchPage, async (page) => {
    all.push(...page);
  });

  return all;
}
