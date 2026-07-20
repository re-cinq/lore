// @vitest-environment jsdom
// Guards the server->client boundary for the /specs and /adrs pages. Both are
// server components rendering the "use client" GlobalDocsView, so every prop
// they pass must be serializable — a function prop throws at render time in
// production with the message redacted. The component's own tests render it
// directly in jsdom, where a function prop is legal, so they cannot catch this.
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

vi.mock("@/lib/trace-api", () => ({
  fetchAllSpecs: async () => [
    {
      repo: "re-cinq/lore",
      filePath: "specs/auth/spec.md",
      status: { status: "shipped", label: "Shipped" },
    },
  ],
  fetchAllAdrs: async () => [
    { repo: "re-cinq/lore", filePath: "adrs/ADR-001-x.md", status: null },
  ],
}));

const functionProps = (node: unknown, path = "root"): string[] => {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => functionProps(child, `${path}[${i}]`));
  }

  if (!isValidElement(node)) {
    return [];
  }
  const element = node as ReactElement<Record<string, unknown>>;
  const name =
    typeof element.type === "string"
      ? element.type
      : ((element.type as { name?: string }).name ?? "Component");

  return Object.entries(element.props).flatMap(([key, value]) =>
    typeof value === "function"
      ? [`${path} > ${name}.${key}`]
      : functionProps(value, `${path} > ${name}`),
  );
};

describe("global doc pages", () => {
  it("passes no function props across the server boundary from /specs", async () => {
    const { default: SpecsPage } = await import("./specs/page");

    expect(functionProps(await SpecsPage())).toEqual([]);
  });

  it("passes no function props across the server boundary from /adrs", async () => {
    const { default: AdrsPage } = await import("./adrs/page");

    expect(functionProps(await AdrsPage())).toEqual([]);
  });
});
