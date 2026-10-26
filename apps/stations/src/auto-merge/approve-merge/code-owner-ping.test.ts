import { describe, expect, it } from "vitest";
import { askedAlready, codeOwnerPing } from "./code-owner-ping.js";

describe("codeOwnerPing", () => {
  it("names each owner once and each owned path, and says the rest is ready, behind a marker that keeps it to one comment", () => {
    const body = codeOwnerPing([
      { path: ".github/workflows/ci.yml", owners: ["@re-cinq/platform"] },
      { path: "infra/main.tf", owners: ["@re-cinq/platform", "@gedaiu"] },
    ]);

    expect({
      mentions: body.split("\n")[0],
      paths: body.includes("`.github/workflows/ci.yml`, `infra/main.tf`"),
      marked: askedAlready([{ body }]),
    }).toEqual({
      mentions:
        "@re-cinq/platform @gedaiu: this pull request is ready to merge except for your approval.",
      paths: true,
      marked: true,
    });
  });

  it("finds no earlier ask among comments that carry no marker", () => {
    expect(askedAlready([{ body: "LGTM" }])).toBe(false);
  });
});
