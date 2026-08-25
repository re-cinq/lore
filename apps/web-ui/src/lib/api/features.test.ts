// @vitest-environment node
//
// The paths and body field names ARE the contract with lore-api. A rename on
// either side is silent otherwise: `apiFetch` reports failure in its return value,
// and a server action that ignores it turns a 404 into a page that looks like it
// worked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  createFeature,
  refineFeature,
  createSpecFile,
  splitFeature,
  deleteFeature,
  listFeatures,
  getFeature,
  getFeatureStatus,
  getFeatureDecomposition,
} = await import("./features");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

const url = () => fetchMock.mock.calls[0][0];
const init = () => fetchMock.mock.calls[0][1];
const body = () => JSON.parse(init().body as string);

describe("createFeature", () => {
  it("posts the title and prompt to the repo's features collection", async () => {
    await createFeature("re-cinq/lore", "Spec standard", "Write it down");

    expect(url()).toEqual("http://api:3000/api/repos/re-cinq/lore/features");
    expect(init().method).toEqual("POST");
    expect(body()).toEqual({ title: "Spec standard", prompt: "Write it down" });
  });
});

describe("refineFeature", () => {
  it("posts user_answers to the feature's iterations path", async () => {
    await refineFeature("re-cinq/lore", "f1", { overview: "tighter" });

    expect(url()).toEqual(
      "http://api:3000/api/repos/re-cinq/lore/features/f1/iterations",
    );
    expect(body()).toEqual({ user_answers: { overview: "tighter" } });
  });

  it("omits from_iteration entirely when the round continues the latest", async () => {
    await refineFeature("re-cinq/lore", "f1", {});

    expect("from_iteration" in body()).toEqual(false);
  });

  it("sends from_iteration when the round rewinds to an earlier one", async () => {
    await refineFeature("re-cinq/lore", "f1", {}, 2);

    expect(body()).toEqual({ user_answers: {}, from_iteration: 2 });
  });

  it("sends from_iteration 0, which is a rewind and not an absent value", async () => {
    await refineFeature("re-cinq/lore", "f1", {}, 0);

    expect(body().from_iteration).toEqual(0);
  });
});

describe("createSpecFile", () => {
  it("posts the author's answers to the feature's create-spec-file path", async () => {
    await createSpecFile("re-cinq/lore", "f1", {
      free_form: "drop the poller",
    });

    // Not `/finalize`: nothing is final here — the run moves to the next station
    // and a human still reviews the spec PR that comes out.
    expect(url()).toEqual(
      "http://api:3000/api/repos/re-cinq/lore/features/f1/create-spec-file",
    );
    // The author fills the form and accepts in one motion; an empty body here
    // dropped the last thing they said before the plan became a spec.
    expect(body()).toEqual({
      user_answers: { free_form: "drop the poller" },
    });
  });
});

describe("splitFeature", () => {
  it("posts the child's title and prompt to the parent's split path", async () => {
    await splitFeature("re-cinq/lore", "parent", "Child", "Do less");

    expect(url()).toEqual(
      "http://api:3000/api/repos/re-cinq/lore/features/parent/split",
    );
    expect(body()).toEqual({ title: "Child", prompt: "Do less" });
  });
});

describe("deleteFeature", () => {
  it("sends DELETE to the feature itself, with no body", async () => {
    await deleteFeature("re-cinq/lore", "f1");

    expect(url()).toEqual("http://api:3000/api/repos/re-cinq/lore/features/f1");
    expect(init().method).toEqual("DELETE");
    expect(init().body).toBeUndefined();
  });
});

describe("feature reads", () => {
  it("lists the repo's features from the collection path", async () => {
    await listFeatures("re-cinq/lore");

    expect(url()).toEqual("http://api:3000/api/repos/re-cinq/lore/features");
  });

  it("reads one feature with its rounds from the feature path", async () => {
    await getFeature("re-cinq/lore", "f1");

    expect(url()).toEqual("http://api:3000/api/repos/re-cinq/lore/features/f1");
  });

  it("polls the round's status from the status path", async () => {
    await getFeatureStatus("re-cinq/lore", "f1");

    expect(url()).toEqual(
      "http://api:3000/api/repos/re-cinq/lore/features/f1/status",
    );
  });

  it("reads the decomposed spec-tasks from the decomposition path", async () => {
    await getFeatureDecomposition("re-cinq/lore", "f1");

    expect(url()).toEqual(
      "http://api:3000/api/repos/re-cinq/lore/features/f1/decomposition",
    );
  });
});
