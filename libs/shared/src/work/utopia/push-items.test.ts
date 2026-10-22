import { describe, it, expect } from "vitest";
import { tombstone } from "../../domain/utopia/statements.js";
import type {
  DocumentPushOutcome,
  PushAction,
} from "../../outbound/utopia/utopia-client.js";
import {
  combineOutcomes,
  mirrorFailure,
  pushDocuments,
  pushItems,
} from "./push-items.js";

const answering = (actions: Record<string, PushAction>) => ({
  push: async ({ externalId }: { externalId: string }) => ({
    action: actions[externalId],
  }),
});

describe("pushItems", () => {
  it("counts doc:a created, doc:b updated and doc:c unchanged and names nothing under failed", async () => {
    const outcome = await pushItems(
      answering({
        "doc:a": "created",
        "doc:b": "updated",
        "doc:c": "unchanged",
      }),
      [tombstone("doc:a"), tombstone("doc:b"), tombstone("doc:c")],
    );

    expect(outcome).toEqual({
      items: 3,
      created: 1,
      updated: 1,
      unchanged: 1,
      failed: [],
    });
  });

  it("names test:a.ts under failed and counts no NaN when Utopia answers duplicate", async () => {
    const outcome = await pushItems(
      answering({ "test:a.ts": "duplicate", "test:b.ts": "created" }),
      [tombstone("test:a.ts"), tombstone("test:b.ts")],
    );

    expect(outcome).toEqual({
      items: 2,
      created: 1,
      updated: 0,
      unchanged: 0,
      failed: [
        "test:a.ts: duplicate, another document in the knowledge base holds the same content",
      ],
    });
  });

  it("counts nothing for a tombstone Utopia marked missing", async () => {
    const outcome = await pushItems(answering({ "doc:a": "marked_missing" }), [
      tombstone("doc:a"),
    ]);

    expect(outcome).toEqual({
      items: 1,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: [],
    });
  });
});

describe("mirrorFailure", () => {
  it("names the first of two failed items and the item count", () => {
    expect(
      mirrorFailure({
        items: 5,
        created: 3,
        updated: 0,
        unchanged: 0,
        failed: ["a: boom", "b: bang"],
      }),
    ).toEqual("2 of 5 items failed: a: boom");
  });
});

describe("pushDocuments", () => {
  it("counts doc:a created, doc:b moved as updated and doc:c unchanged and names doc:d under failed when Utopia answers duplicate", async () => {
    const answers: Record<string, DocumentPushOutcome["action"]> = {
      "doc:a": "created",
      "doc:b": "moved",
      "doc:c": "unchanged",
      "doc:d": "duplicate",
      "doc:e": "marked_missing",
    };
    const outcome = await pushDocuments(
      { push: async ({ external_id }) => ({ action: answers[external_id] }) },
      Object.keys(answers).map((external_id) => ({
        external_id,
        filename: external_id,
      })),
    );

    expect(outcome).toEqual({
      items: 5,
      created: 1,
      updated: 1,
      unchanged: 1,
      failed: [
        "doc:d: duplicate, another document in the knowledge base holds the same content",
      ],
    });
  });
});

describe("combineOutcomes", () => {
  it("adds 2 + 1 items and keeps the failed of both in order", () => {
    expect(
      combineOutcomes(
        { items: 2, created: 1, updated: 0, unchanged: 0, failed: ["a: x"] },
        { items: 1, created: 0, updated: 1, unchanged: 0, failed: ["b: y"] },
      ),
    ).toEqual({
      items: 3,
      created: 1,
      updated: 1,
      unchanged: 0,
      failed: ["a: x", "b: y"],
    });
  });
});
