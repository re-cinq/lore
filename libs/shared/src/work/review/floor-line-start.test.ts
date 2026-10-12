import { describe, expect, it } from "vitest";
import { recordedFloor } from "../../outbound/floor/recorded-floor.js";
import { startLine } from "./floor-line-start.js";

const STARTING = { repo: "github.com/re-cinq/lore", startItems: {} };

function refusal(status: number, detail: string): Response {
  return new Response(
    JSON.stringify({ type: "about:blank", title: "Refused", status, detail }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

function thrownBy(answer: unknown): Promise<unknown> {
  const { floor } = recordedFloor(() => answer);

  return startLine(floor.lines, "code-review", STARTING).catch(
    (err: unknown) => err,
  );
}

describe("startLine", () => {
  it("throws an error carrying maxAttempts 10 when the floor has no line named code-review", async () => {
    const thrown = await thrownBy(refusal(400, 'no line named "code-review"'));

    expect(thrown).toMatchObject({ maxAttempts: 10 });
  });

  it("says the floor does not have the line yet when it refuses for lack of the line", async () => {
    const thrown = await thrownBy(refusal(400, 'no line named "code-review"'));

    expect((thrown as Error).message).toContain(
      "the floor does not have the line yet",
    );
  });

  it("throws no maxAttempts for a 500 refusal", async () => {
    const thrown = await thrownBy(refusal(500, "database down"));

    expect(thrown).not.toHaveProperty("maxAttempts");
  });

  it("throws no maxAttempts for a 400 that is not about a missing line", async () => {
    const thrown = await thrownBy(refusal(400, "startItems is required"));

    expect(thrown).not.toHaveProperty("maxAttempts");
  });

  it("answers the started run when the floor takes the start", async () => {
    const { floor } = recordedFloor(() => ({
      run: { id: "run-new" },
      joined: false,
    }));

    expect(await startLine(floor.lines, "code-review", STARTING)).toEqual({
      run: { id: "run-new" },
      joined: false,
    });
  });
});
