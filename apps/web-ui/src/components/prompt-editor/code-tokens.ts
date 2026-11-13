import { common, createLowlight } from "lowlight";
import type { ElementContent, Root } from "hast";
import { languageForTag } from "@/lib/code-lang";
import type { FencedBlock } from "./fenced-blocks";
import type { Range } from "./ranges";

export interface CodeToken extends Range {
  className: string;
}

const lowlight = createLowlight(common);
const FENCE_LANGUAGE = /^ *(?:`{3,}|~{3,}) *(\S+)/;
const CACHE_LIMIT = 200;

// Tokens by language and code, positioned from the start of the code, so an edit re-tokenises only the block it lands in.
const tokenCache = new Map<string, CodeToken[]>();

/** The syntax tokens of every fenced block that names a language, as ranges strictly inside its content lines. */
export function codeTokens(text: string, blocks: FencedBlock[]): CodeToken[] {
  return blocks.flatMap((block) => blockTokens(text, block));
}

function blockTokens(text: string, block: FencedBlock): CodeToken[] {
  const language = languageForTag(
    FENCE_LANGUAGE.exec(block.opening.text)?.[1] ?? "",
  );
  const content = block.lines.slice(1, block.closing ? -1 : undefined);

  if (content.length === 0 || !lowlight.registered(language)) {
    return [];
  }
  const start = content[0].from;
  const code = text.slice(start, content[content.length - 1].to);

  return tokensOfCode(language, code).map((token) => ({
    ...token,
    from: start + token.from,
    to: start + token.to,
  }));
}

function tokensOfCode(language: string, code: string): CodeToken[] {
  const key = `${language}\0${code}`;
  const cached = tokenCache.get(key);

  if (cached) {
    return cached;
  }
  const tokens = tokensIn(lowlight.highlight(language, code));

  if (tokenCache.size >= CACHE_LIMIT) {
    tokenCache.clear();
  }
  tokenCache.set(key, tokens);

  return tokens;
}

function tokensIn(root: Root): CodeToken[] {
  const tokens: CodeToken[] = [];

  walk(root.children, 0, tokens);

  return tokens.sort((a, b) => a.from - b.from || b.to - a.to);
}

// Walks the tree in text order and returns where it ended.
function walk(
  children: (ElementContent | Root["children"][number])[],
  at: number,
  tokens: CodeToken[],
): number {
  return children.reduce((position, child) => {
    if (child.type === "text") {
      return position + child.value.length;
    }

    if (child.type !== "element") {
      return position;
    }
    const end = walk(child.children, position, tokens);
    const className = [child.properties.className ?? []].flat().join(" ");

    tokens.push({ from: position, to: end, className });

    return end;
  }, at);
}
