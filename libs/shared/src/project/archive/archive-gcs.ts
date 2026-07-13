import { Storage } from "@google-cloud/storage";
import type { ArchivePort, ArchiveSaveOptions } from "./archive-port.js";

/**
 * The slice of the GCS client the adapter touches — a structural seam so tests
 * inject a fake instead of mocking the SDK module.
 */
export interface StorageLike {
  bucket(name: string): {
    file(key: string): {
      save(body: string, options: Record<string, unknown>): Promise<void>;
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
    body: string,
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
    try {
      const file = this.storage.bucket(this.bucketName).file(key);
      const [exists] = await file.exists();

      if (!exists) {
        return null;
      }
      const [content] = await file.download();

      return content.toString("utf-8");
    } catch {
      return null;
    }
  }
}
