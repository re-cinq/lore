import { describe, it, expect, afterEach, vi } from "vitest";
import { buildServer } from "../server.js";
import { startReview } from "../../../jobs/review/code-review.js";
import { projectFor } from "../../../composition/project-boot.js";

vi.mock("../../../jobs/review/code-review.js", () => ({
  startReview: vi.fn(),
}));
vi.mock("../../../composition/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({})),
}));

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;
  } else {
    process.env.LORE_INGEST_TOKEN = ORIG;
  }
  vi.mocked(startReview).mockReset();
  vi.mocked(projectFor).mockClear();
});

const post = (payload: string, token = "right-token") =>
  buildServer({ getJobStatus: () => ({}) }).inject({
    method: "POST",
    url: "/api/review/start",
    headers: { authorization: `Bearer ${token}` },
    payload,
  });

describe("POST /api/review/start", () => {
  it("returns 401 on a wrong bearer token", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";

    expect((await post("{}", "wrong")).statusCode).toBe(401);
  });

  it("returns 400 when repo or pr_number is missing", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";

    expect(
      (await post(JSON.stringify({ repo: "re-cinq/lore" }))).statusCode,
    ).toBe(400);
  });

  it("starts a forced review and returns 202 with the line id", async () => {
    process.env.LORE_INGEST_TOKEN = "right-token";
    vi.mocked(startReview).mockResolvedValueOnce("al-9");

    const res = await post(
      JSON.stringify({ repo: "re-cinq/lore", pr_number: 42 }),
    );

    expect(res.statusCode).toBe(202);
    expect(res.result).toMatchObject({ started: "al-9" });
    expect(vi.mocked(startReview).mock.calls[0]?.[1]).toMatchObject({
      prNumber: 42,
      forced: true,
    });
  });
});
