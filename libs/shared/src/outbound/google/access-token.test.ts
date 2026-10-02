import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  googleCredentials,
  resetGoogleProjectCache,
  resolveGoogleAccessToken,
  resolveGoogleProject,
} from "./access-token.js";

const SAVED = { ...process.env };

function metadataAnswering(answers: {
  token?: string;
  project?: string;
}): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.includes("service-accounts/default/token") && answers.token) {
      return {
        ok: true,
        json: async () => ({ access_token: answers.token }),
      } as Response;
    }

    if (url.includes("/project/project-id") && answers.project) {
      return {
        ok: true,
        text: async () => `${answers.project}\n`,
      } as Response;
    }

    throw new Error("no metadata server");
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetGoogleProjectCache();
  delete process.env.GCP_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_ACCESS_TOKEN;
});
afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
  resetGoogleProjectCache();
});

describe("resolveGoogleProject", () => {
  it("returns GCP_PROJECT from the environment without hitting the metadata server", async () => {
    process.env.GCP_PROJECT = "proj-from-env";
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveGoogleProject()).toBe("proj-from-env");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the GKE metadata server project-id when env is unset", async () => {
    vi.stubGlobal(
      "fetch",
      metadataAnswering({ project: "proj-from-metadata" }),
    );

    expect(await resolveGoogleProject()).toBe("proj-from-metadata");
  });

  it("returns an empty project when neither the environment nor the metadata server names one", async () => {
    vi.stubGlobal("fetch", metadataAnswering({}));

    expect(await resolveGoogleProject()).toBe("");
  });
});

describe("resolveGoogleAccessToken", () => {
  it("returns the metadata server's token for the pod's identity", async () => {
    vi.stubGlobal("fetch", metadataAnswering({ token: "tok-from-metadata" }));

    expect(await resolveGoogleAccessToken()).toBe("tok-from-metadata");
  });

  it("falls back to GOOGLE_ACCESS_TOKEN when there is no metadata server", async () => {
    process.env.GOOGLE_ACCESS_TOKEN = "tok-from-env";
    vi.stubGlobal("fetch", metadataAnswering({}));

    expect(await resolveGoogleAccessToken()).toBe("tok-from-env");
  });

  it("returns an empty token when neither source has one", async () => {
    vi.stubGlobal("fetch", metadataAnswering({}));

    expect(await resolveGoogleAccessToken()).toBe("");
  });
});

describe("googleCredentials", () => {
  it("returns the token and the project together", async () => {
    vi.stubGlobal(
      "fetch",
      metadataAnswering({ token: "tok", project: "my-project" }),
    );

    expect(await googleCredentials()).toEqual({
      token: "tok",
      project: "my-project",
    });
  });
});
