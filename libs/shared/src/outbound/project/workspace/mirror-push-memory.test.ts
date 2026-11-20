import { describe, it, expect } from "vitest";
import { InMemoryMirrorPush } from "./mirror-push-memory.js";
import type { MirrorPushRequest } from "./mirror-push-port.js";

const request: MirrorPushRequest = {
  sourceUrl: "source",
  sourceAuthArgs: [],
  targetUrl: "target",
  targetAuthArgs: [],
  sha: "c2",
  tag: "v1.0.0",
};

describe("InMemoryMirrorPush", () => {
  it("moves target main to c2 and creates v1.0.0 when c1 is an ancestor of c2", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedTarget("target", { head: "c1", tags: {} });
    mirror.seedHistory("c2", ["c1"]);

    expect({
      outcome: await mirror.push(request),
      target: mirror.targetOf("target"),
    }).toEqual({
      outcome: { kind: "pushed", sha: "c2", tag: "v1.0.0" },
      target: { head: "c2", tags: { "v1.0.0": "c2" } },
    });
  });

  it("answers already up to date on a second identical push", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedHistory("c2", ["c1"]);
    await mirror.push(request);

    expect(await mirror.push(request)).toEqual({
      kind: "already-up-to-date",
      sha: "c2",
      tag: "v1.0.0",
    });
  });

  it("leaves target main at x9 when it is not an ancestor of c2", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedTarget("target", { head: "x9", tags: {} });
    mirror.seedHistory("c2", ["c1"]);

    expect({
      outcome: await mirror.push(request),
      target: mirror.targetOf("target"),
    }).toEqual({
      outcome: { kind: "target-diverged", targetHead: "x9" },
      target: { head: "x9", tags: {} },
    });
  });

  it("refuses and moves nothing when v1.0.0 sits at c1", async () => {
    const mirror = new InMemoryMirrorPush();

    mirror.seedTarget("target", { head: "c1", tags: { "v1.0.0": "c1" } });
    mirror.seedHistory("c2", ["c1"]);

    expect({
      outcome: await mirror.push(request),
      target: mirror.targetOf("target"),
    }).toEqual({
      outcome: { kind: "tag-at-other-sha", tagSha: "c1" },
      target: { head: "c1", tags: { "v1.0.0": "c1" } },
    });
  });
});
