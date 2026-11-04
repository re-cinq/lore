// One primer per repository, for its current default-branch head: written on the first call after a push, reused by every call until the next, which replaces it.

export type PrimerAt = (repo: string, head: string) => Promise<string>;

export function primerCache(
  write: (repo: string) => Promise<string>,
): PrimerAt {
  const written = new Map<string, { head: string; writing: Promise<string> }>();

  return (repo, head) => {
    const key = repo.toLowerCase();
    const held = written.get(key);

    if (held?.head === head) {
      return held.writing;
    }
    const writing = write(repo);
    const entry = { head, writing };

    written.set(key, entry);
    writing.catch(() => written.get(key) === entry && written.delete(key));

    return writing;
  };
}
