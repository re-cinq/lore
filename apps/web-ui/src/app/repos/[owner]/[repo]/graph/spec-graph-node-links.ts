import { DEFAULT_GITHUB_HOST, githubUrls } from "@/lib/github-host";
import type { SpecGraphNode } from "@/lib/spec-graph";

/** The "Open in Lore" / "View on GitHub" links shown on a selected node's detail card. */

export type NodeLink = { label: string; href: string; external: boolean };

const SPEC_FAMILY_TYPES = new Set<SpecGraphNode["type"]>([
  "Spec",
  "Statement",
  "Section",
]);

export function nodeLinks(
  node: SpecGraphNode,
  repo: string,
  host: string = DEFAULT_GITHUB_HOST,
): NodeLink[] {
  return [loreLink(node), githubLink(node, repo, host)].filter(
    (link): link is NodeLink => link !== null,
  );
}

function loreLink(node: SpecGraphNode): NodeLink | null {
  if (!SPEC_FAMILY_TYPES.has(node.type) || !node.path) {
    return null;
  }

  return {
    label: "Open in Lore",
    href: `/specs/${encodeURIComponent(node.path)}`,
    external: false,
  };
}

function githubLink(
  node: SpecGraphNode,
  repo: string,
  host: string,
): NodeLink | null {
  if (!node.path) {
    return null;
  }

  const line = node.line ? `#L${node.line}` : "";

  return {
    label: "View on GitHub",
    href: `${githubUrls(host).web}/${repo}/blob/HEAD/${node.path}${line}`,
    external: true,
  };
}
