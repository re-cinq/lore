import { describe, expect, it } from "vitest";
import { InMemoryPulls } from "./pull-requests-memory.js";

const REPO = "acme/private-app";

describe("InMemoryPulls", () => {
  it("lists pull request 2 before 1 for branch sync/public-main and leaves out another branch", async () => {
    const pulls = new InMemoryPulls();

    await pulls.open(REPO, "sync/public-main", { title: "first", body: "b" });
    await pulls.open(REPO, "feature", { title: "other", body: "b" });
    await pulls.open(REPO, "sync/public-main", { title: "second", body: "b" });

    expect(
      (await pulls.listByHead(REPO, "sync/public-main")).map(
        (pull) => pull.title,
      ),
    ).toEqual(["second", "first"]);
  });

  it("marks pull request 1 merged at head h1 and lists its comment", async () => {
    const pulls = new InMemoryPulls();

    await pulls.open(REPO, "sync/public-main", { title: "first", body: "b" });
    pulls.seedMerged(REPO, 1, "h1");
    await pulls.comment(REPO, 1, "note");

    expect({
      pull: (await pulls.listByHead(REPO, "sync/public-main"))[0],
      comments: (await pulls.listIssueComments(REPO, 1)).map(
        ({ body }) => body,
      ),
    }).toMatchObject({
      pull: { number: 1, state: "merged", headSha: "h1" },
      comments: ["note"],
    });
  });
});
