// @vitest-environment node

import { describe, it, expect, vi, afterEach } from "vitest";
import { readBlobPreviews } from "./blob-previews";

const ISSUE = `sha256-${"a".repeat(64)}`;
const PLAN = `sha256-${"c".repeat(64)}`;
const SPEC = `sha256-${"d".repeat(64)}`;

const preview = (hash: string) => ({
  hash,
  contentType: "text/markdown",
  size: 8,
  text: "# title\n",
  truncated: false,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readBlobPreviews", () => {
  it("asks only for the plan once the issue's preview is held", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ previews: { [ISSUE]: preview(ISSUE) } }),
      )
      .mockResolvedValueOnce(
        Response.json({ previews: { [PLAN]: preview(PLAN) } }),
      );

    vi.stubGlobal("fetch", fetchMock);
    await readBlobPreviews("run-1", [ISSUE]);
    const both = await readBlobPreviews("run-1", [ISSUE, PLAN]);

    expect({
      both: Object.keys(both),
      secondUrl: String(fetchMock.mock.calls[1]?.[0]),
    }).toEqual({
      both: [ISSUE, PLAN],
      secondUrl: `/api/assembly-runs/run-1/blob-previews?hash=${PLAN}`,
    });
  });

  it("answers no previews when the read fails with 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );

    expect(await readBlobPreviews("run-1", [SPEC])).toEqual({});
  });
});
