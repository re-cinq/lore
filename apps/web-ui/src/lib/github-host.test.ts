import { describe, expect, it } from "vitest";
import {
  DEFAULT_GITHUB_HOST,
  githubHost,
  githubHostPattern,
  githubIssueUrl,
  githubPullUrl,
  githubUrls,
} from "./github-host";

describe("githubHost", () => {
  it("returns github.com when GITHUB_HOST is unset", () => {
    expect(githubHost({})).toEqual(DEFAULT_GITHUB_HOST);
  });

  it("returns github.com when GITHUB_HOST is empty", () => {
    expect(githubHost({ GITHUB_HOST: "" })).toEqual("github.com");
  });

  it("returns ghe.example.com for GITHUB_HOST in capitals with spaces around it", () => {
    expect(githubHost({ GITHUB_HOST: " GHE.Example.com " })).toEqual(
      "ghe.example.com",
    );
  });

  it.each(["https://ghe.example.com", "ghe.example.com/", "ghe example.com"])(
    "throws for GITHUB_HOST %s that is not a bare host",
    (value) => {
      expect(() => githubHost({ GITHUB_HOST: value })).toThrow(
        new Error(`GITHUB_HOST must be a bare host name, got "${value}"`),
      );
    },
  );
});

describe("githubUrls", () => {
  it("returns the github.com urls for host github.com", () => {
    expect(githubUrls("github.com")).toEqual({
      web: "https://github.com",
      api: "https://api.github.com",
      oauthAuthorize: "https://github.com/login/oauth/authorize",
      oauthToken: "https://github.com/login/oauth/access_token",
    });
  });

  it("returns https://ghe.example.com/api/v3 as the api for host ghe.example.com", () => {
    expect(githubUrls("ghe.example.com")).toEqual({
      web: "https://ghe.example.com",
      api: "https://ghe.example.com/api/v3",
      oauthAuthorize: "https://ghe.example.com/login/oauth/authorize",
      oauthToken: "https://ghe.example.com/login/oauth/access_token",
    });
  });

  it("returns the github.com urls when no host is given", () => {
    expect(githubUrls().web).toEqual("https://github.com");
  });
});

describe("githubHostPattern", () => {
  it("escapes the dots of github.com", () => {
    expect(githubHostPattern("github.com")).toEqual("github\\.com");
  });

  it("matches ghe.example.com and not gheXexample.com", () => {
    const pattern = new RegExp(`^${githubHostPattern("ghe.example.com")}$`);

    expect([
      pattern.test("ghe.example.com"),
      pattern.test("gheXexample.com"),
    ]).toEqual([true, false]);
  });
});

describe("githubIssueUrl and githubPullUrl", () => {
  it("returns https://github.com/re-cinq/lore/issues/7 when no host is given", () => {
    expect(githubIssueUrl("re-cinq/lore", 7)).toEqual(
      "https://github.com/re-cinq/lore/issues/7",
    );
  });

  it("returns https://ghe.example.com/re-cinq/lore/issues/7 for host ghe.example.com", () => {
    expect(githubIssueUrl("re-cinq/lore", "7", "ghe.example.com")).toEqual(
      "https://ghe.example.com/re-cinq/lore/issues/7",
    );
  });

  it("returns https://ghe.example.com/re-cinq/lore/pull/7 for host ghe.example.com", () => {
    expect(githubPullUrl("re-cinq/lore", 7, "ghe.example.com")).toEqual(
      "https://ghe.example.com/re-cinq/lore/pull/7",
    );
  });
});
