import { describe, expect, it } from "vitest";
import { appAuthOptions, githubApiUrl } from "./github-client.js";

const appEnv = {
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "key",
  GITHUB_APP_INSTALLATION_ID: "2",
};

describe("appAuthOptions", () => {
  it("returns the App triple with a request pointed at https://api.github.com when GITHUB_HOST is unset", () => {
    const options = appAuthOptions(appEnv);

    expect({
      triple: [options.appId, options.privateKey, options.installationId],
      baseUrl: options.request.endpoint.DEFAULTS.baseUrl,
    }).toEqual({
      triple: ["1", "key", "2"],
      baseUrl: "https://api.github.com",
    });
  });

  it("returns a request pointed at https://ghe.example.com/api/v3 for host ghe.example.com", () => {
    const options = appAuthOptions({
      ...appEnv,
      GITHUB_HOST: "ghe.example.com",
    });

    expect(options.request.endpoint.DEFAULTS.baseUrl).toEqual(
      "https://ghe.example.com/api/v3",
    );
  });
});

describe("githubApiUrl", () => {
  it("returns https://api.github.com/repos/o/r when GITHUB_HOST is unset", () => {
    expect(githubApiUrl("/repos/o/r", {})).toEqual(
      "https://api.github.com/repos/o/r",
    );
  });

  it("returns https://ghe.example.com/api/v3/repos/o/r for host ghe.example.com", () => {
    expect(
      githubApiUrl("/repos/o/r", { GITHUB_HOST: "ghe.example.com" }),
    ).toEqual("https://ghe.example.com/api/v3/repos/o/r");
  });
});
