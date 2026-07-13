import type { ArchivePort, ArchiveSaveOptions } from "./archive-port.js";

/** In-memory ArchivePort double for tests. */
export class InMemoryArchive implements ArchivePort {
  readonly objects = new Map<
    string,
    { body: string; options: ArchiveSaveOptions }
  >();

  async save(
    key: string,
    body: string,
    options: ArchiveSaveOptions,
  ): Promise<void> {
    this.objects.set(key, { body, options });
  }

  async read(key: string): Promise<string | null> {
    return this.objects.get(key)?.body ?? null;
  }
}
