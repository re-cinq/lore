import { describe, it, expect } from "vitest";
import {
  repoSettingsOf,
  currentSettingsOf,
  approvalPrFrom,
} from "./page-input";

describe("repoSettingsOf", () => {
  it("returns the repo's settings blob when the read succeeded", () => {
    expect(
      repoSettingsOf({
        status: "ok",
        data: { settings: { dark_factory: { execution: { image: "x" } } } },
      }),
    ).toEqual({ dark_factory: { execution: { image: "x" } } });
  });

  it("returns an empty object when the read failed", () => {
    expect(repoSettingsOf({ status: "error" })).toEqual({});
  });

  it("returns an empty object when the settings blob is absent", () => {
    expect(repoSettingsOf({ status: "ok", data: {} })).toEqual({});
  });
});

describe("currentSettingsOf", () => {
  it("resolves defaults when there is no dark_factory block", () => {
    const current = currentSettingsOf({});

    expect(current.dark_factory?.enabled).toBe(false);
    expect(current.dark_factory?.execution).toBeUndefined();
  });

  it("carries the raw execution block alongside the resolved settings", () => {
    const current = currentSettingsOf({
      dark_factory: { execution: { image: "custom:tag" } },
    });

    expect(current.dark_factory?.execution).toEqual({ image: "custom:tag" });
  });
});

describe("approvalPrFrom", () => {
  it("returns the trimmed value when present", () => {
    const formData = new FormData();

    formData.set("approval_pr", "  https://github.com/o/r/pull/1  ");

    expect(approvalPrFrom(formData)).toBe("https://github.com/o/r/pull/1");
  });

  it("returns undefined when the field is blank", () => {
    const formData = new FormData();

    formData.set("approval_pr", "   ");

    expect(approvalPrFrom(formData)).toBeUndefined();
  });

  it("returns undefined when the field is absent", () => {
    const formData = new FormData();

    expect(approvalPrFrom(formData)).toBeUndefined();
  });
});
