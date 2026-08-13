import type { ArchivePort, ArchiveSaveOptions } from "./archive-port.js";

/** In-memory ArchivePort double for tests. */
export class InMemoryArchive implements ArchivePort {
  readonly objects = new Map<
    string,
    { body: string | Uint8Array; options: ArchiveSaveOptions }
  >();

  async save(
    key: string,
    body: string | Uint8Array,
    options: ArchiveSaveOptions,
  ): Promise<void> {
    this.objects.set(key, { body, options });
  }

  async read(key: string): Promise<string | null> {
    const body = this.objects.get(key)?.body;

    if (body === undefined) {
      return null;
    }

    return typeof body === "string"
      ? body
      : Buffer.from(body).toString("utf-8");
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const body = this.objects.get(key)?.body;

    if (body === undefined) {
      return null;
    }

    return typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  }
}
