// A filesystem ArchivePort so local dev has somewhere to put the bytes GCS holds in production, letting the resume path run outside a real cluster.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { enforceTrue } from "../../lib/enforce.js";
import type { ArchivePort, ArchiveSaveOptions } from "./archive-port.js";

export class FileArchive implements ArchivePort {
  constructor(private readonly root: string) {}

  /** `options` carries the content type, which only an object store records; accepted and ignored here. */
  async save(
    key: string,
    body: string | Uint8Array,
    _options?: ArchiveSaveOptions,
  ): Promise<void> {
    const path = this.pathFor(key);

    enforceTrue(path, Error, `archive key escapes the root: "${key}"`);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof body === "string" ? body : Buffer.from(body));
  }

  async read(key: string): Promise<string | null> {
    const bytes = await this.readBytes(key);

    return bytes === null ? null : Buffer.from(bytes).toString("utf-8");
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const path = this.pathFor(key);

    if (!path) {
      return null;
    }

    // A missing object is not an error for either caller — the conversation GET answers 404, the pod degrades to a fresh conversation.
    return readFile(path).catch(() => null);
  }

  /** The absolute path for a key, or null when it would escape the root — keys are built from ids arriving over HTTP, so traversal is refused here. */
  private pathFor(key: string): string | null {
    const path = resolve(join(this.root, key));
    const rel = relative(resolve(this.root), path);

    return rel && !rel.startsWith("..") ? path : null;
  }
}
