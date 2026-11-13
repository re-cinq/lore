import { describe, it, expect } from "vitest";
import {
  draftOf,
  parseMcpServers,
  serversOf,
  type McpServerDraft,
} from "./mcp-servers-form";

const BLANK: McpServerDraft = {
  name: "",
  transport: "http",
  url: "",
  command: "",
  args: "",
  headersSecret: "",
  secrets: [],
};

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }

  return form;
}

describe("serversOf", () => {
  it("turns an http draft's secret rows into headers and keeps its Authorization secret", () => {
    expect(
      serversOf([
        {
          ...BLANK,
          name: "search",
          url: "https://search.test/mcp",
          headersSecret: "search-auth",
          secrets: [{ name: "X-API-Key", ref: "search-api-key" }],
        },
      ]),
    ).toEqual([
      {
        name: "search",
        transport: "http",
        url: "https://search.test/mcp",
        headers_secret: "search-auth",
        headers: [{ name: "X-API-Key", ref: "search-api-key" }],
      },
    ]);
  });

  it("turns a stdio draft's 'npx -y files-mcp' into command npx with two args and its secret rows into env", () => {
    expect(
      serversOf([
        {
          ...BLANK,
          name: "files",
          transport: "stdio",
          command: "npx",
          args: "-y  files-mcp",
          secrets: [{ name: "API_KEY", ref: "files-api-key" }],
        },
      ]),
    ).toEqual([
      {
        name: "files",
        transport: "stdio",
        command: "npx",
        args: ["-y", "files-mcp"],
        env: [{ name: "API_KEY", ref: "files-api-key" }],
      },
    ]);
  });

  it("drops a draft with no name and a secret row with no secret key", () => {
    expect(
      serversOf([
        BLANK,
        {
          ...BLANK,
          name: "search",
          url: "https://search.test/mcp",
          secrets: [{ name: "X-API-Key", ref: " " }],
        },
      ]),
    ).toEqual([
      { name: "search", transport: "http", url: "https://search.test/mcp" },
    ]);
  });
});

describe("draftOf", () => {
  it("reads a stdio server's env into secret rows and joins its args with spaces", () => {
    expect(
      draftOf({
        name: "files",
        transport: "stdio",
        command: "npx",
        args: ["-y", "files-mcp"],
        env: [{ name: "API_KEY", ref: "files-api-key" }],
      }),
    ).toEqual({
      ...BLANK,
      name: "files",
      transport: "stdio",
      command: "npx",
      args: "-y files-mcp",
      secrets: [{ name: "API_KEY", ref: "files-api-key" }],
    });
  });
});

describe("parseMcpServers", () => {
  it("returns undefined when the form carries no mcp_servers field, so a save keeps the stored list", () => {
    expect(parseMcpServers(fd({}))).toBeUndefined();
  });

  it("returns an empty list for an emptied one, so a repo's save runs none of the org's servers", () => {
    expect(parseMcpServers(fd({ mcp_servers: "[]" }))).toEqual([]);
  });

  it("returns the files server the field holds as JSON", () => {
    const files = { name: "files", transport: "stdio", command: "npx" };

    expect(
      parseMcpServers(fd({ mcp_servers: JSON.stringify([files]) })),
    ).toEqual([files]);
  });
});
