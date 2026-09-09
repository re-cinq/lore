import { Storage } from "@google-cloud/storage";
import type { ArchivePort, ArchiveSaveOptions } from "./archive-port.js";

/** The slice of the GCS client the adapter touches — a structural seam so tests inject a fake instead of mocking the SDK module. */
export interface StorageLike {
  bucket(name: string): {
    file(key: string): {
      save(
        body: string | Uint8Array,
        options: Record<string, unknown>,
      ): Promise<void>;
      exists(): Promise<[boolean]>;
      download(): Promise<[Buffer]>;
    };
  };
}

export class GcsArchive implements ArchivePort {
  constructor(
    private readonly bucketName: string,
    private readonly storage: StorageLike = new Storage(),
  ) {}

  async save(
    key: string,
    body: string | Uint8Array,
    options: ArchiveSaveOptions,
  ): Promise<void> {
    await this.storage
      .bucket(this.bucketName)
      .file(key)
      .save(body, {
        resumable: false,
        contentType: options.contentType,
        ...(options.cacheControl
          ? { metadata: { cacheControl: options.cacheControl } }
          : {}),
      });
  }

  async read(key: string): Promise<string | null> {
    return (await this.download(key))?.toString("utf-8") ?? null;
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    return this.download(key);
  }

  /** An absent object and an unreachable bucket both read as null: the archive is a best-effort cache, and a caller that cannot tell the two apart would not act differently anyway. */
  private async download(key: string): Promise<Buffer | null> {
    try {
      const file = this.storage.bucket(this.bucketName).file(key);
      const [exists] = await file.exists();

      if (!exists) {
        return null;
      }
      const [content] = await file.download();

      return content;
    } catch {
      return null;
    }
  }
}
