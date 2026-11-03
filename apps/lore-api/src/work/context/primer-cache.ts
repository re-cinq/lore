// One primer per repository and default-branch head: written on the first call after a push, reused by every call until the next.

export type PrimerAt = (repo: string, head: string) => Promise<string>;

export function primerCache(
  write: (repo: string) => Promise<string>,
): PrimerAt {
  const written = new Map<string, Promise<string>>();

  return (repo, head) => {
    const key = `${repo.toLowerCase()}@${head}`;
    const held = written.get(key);

    if (held) {
      return held;
    }
    const writing = write(repo);

    written.set(key, writing);
    writing.catch(() => written.delete(key));

    return writing;
  };
}
