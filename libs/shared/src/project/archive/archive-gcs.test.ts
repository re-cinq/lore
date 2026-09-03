import { enforceTrue } from "../../lib/enforce.js";
import { describe, it, expect } from "vitest";
import { GcsArchive, type StorageLike } from "./archive-gcs.js";

interface SavedCall {
  key: string;
  body: string;
  options: Record<string, unknown>;
}

function fakeStorage(state: {
  saved: SavedCall[];
  contents?: Map<string, string>;
  failing?: boolean;
}): StorageLike {
  return {
    bucket: (bucketName: string) => ({
      file: (key: string) => ({
        save: async (body: string, options: Record<string, unknown>) => {
          enforceTrue(!state.failing, Error, "gcs unavailable");
          state.saved.push({ key: `${bucketName}/${key}`, body, options });
        },
        exists: async (): Promise<[boolean]> => {
          enforceTrue(!state.failing, Error, "gcs unavailable");

          return [state.contents?.has(key) ?? false];
        },
        download: async (): Promise<[Buffer]> => [
          Buffer.from(state.contents?.get(key) ?? "", "utf-8"),
        ],
      }),
    }),
  };
}

describe("GcsArchive.save", () => {
  it("saves to <bucket>/<key> non-resumable with the given content type", async () => {
    const saved: SavedCall[] = [];
    const archive = new GcsArchive("lore-task-logs", fakeStorage({ saved }));

    await archive.save("runs/run-1/output.log", "starting up", {
      contentType: "text/plain",
    });

    expect(saved).toEqual([
      {
        key: "lore-task-logs/runs/run-1/output.log",
        body: "starting up",
        options: { resumable: false, contentType: "text/plain" },
      },
    ]);
  });

  it("passes cacheControl through as file metadata when given", async () => {
    const saved: SavedCall[] = [];
    const archive = new GcsArchive("lore-task-logs", fakeStorage({ saved }));

    await archive.save("k", "body", {
      contentType: "text/plain",
      cacheControl: "no-cache",
    });

    expect(saved[0]?.options).toEqual({
      resumable: false,
      contentType: "text/plain",
      metadata: { cacheControl: "no-cache" },
    });
  });
});

describe("GcsArchive.read", () => {
  it("returns the object content as utf-8 when it exists", async () => {
    const contents = new Map([["runs/run-1/output.log", "line one"]]);
    const archive = new GcsArchive(
      "lore-task-logs",
      fakeStorage({ saved: [], contents }),
    );

    expect(await archive.read("runs/run-1/output.log")).toBe("line one");
  });

  it("returns null when the object does not exist", async () => {
    const archive = new GcsArchive(
      "lore-task-logs",
      fakeStorage({ saved: [] }),
    );

    expect(await archive.read("missing.log")).toBe(null);
  });

  it("returns null when the storage call throws", async () => {
    const archive = new GcsArchive(
      "lore-task-logs",
      fakeStorage({ saved: [], failing: true }),
    );

    expect(await archive.read("any.log")).toBe(null);
  });
});
