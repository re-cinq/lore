import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { proxyToApi, textResult } from "../shared/deps.js";
import { repoParam, withRepo, type ServerMode } from "../shared/repo-scope.js";
import { proxiedText } from "../pipeline/shared/pipeline-api.js";

const CODE_DESCRIPTION: Record<ServerMode, string> = {
  full: "The selected code. Defaults to those lines of the file in the current checkout.",
  agent:
    "The selected code. Required: this server has no checkout to read it from.",
};

interface ExplainArgs {
  repo: string;
  path: string;
  start_line: number;
  end_line: number;
  code?: string;
}

interface Explanation {
  answer: string;
  statements: { text: string; via: string }[];
}

export function registerExplainCodeTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_explain_code",
    'What a span of code does, in at most two paragraphs, grounded in the spec statements linked to those lines: a test declared there validates the statement, the spec links the lines as its implementation, or a test validating it runs them. Answers "I don\'t know" when no statement links the lines; it never guesses from the code alone. Instead: lore-query-trace for the raw links and coverage.',
    explainInput(mode),
    (args) => withRepo(args, mode, (a) => explainHandler(a)),
  );
}

function explainInput(mode: ServerMode) {
  return {
    repo: repoParam(mode),
    path: z
      .string()
      .min(1)
      .describe("Repo-relative file path, e.g. src/auth/token.ts."),
    start_line: z
      .number()
      .int()
      .min(1)
      .describe("First selected line, 1-based."),
    end_line: z
      .number()
      .int()
      .min(1)
      .describe("Last selected line, 1-based, inclusive."),
    code: z.string().optional().describe(CODE_DESCRIPTION[mode]),
  };
}

async function explainHandler(args: ExplainArgs) {
  const code = args.code ?? checkoutLines(args);

  if (!code) {
    return textResult(
      `Could not read ${args.path} lines ${args.start_line}-${args.end_line}. Pass the selected code as \`code\`.`,
    );
  }

  return proxiedText(() => postExplain(args, code), {
    op: "explaining code",
    toolName: "lore_explain_code",
    render: (body) => renderExplanation(body as Explanation),
  });
}

function postExplain(
  { repo, path, start_line, end_line }: ExplainArgs,
  code: string,
) {
  return proxyToApi(`/api/repos/${repo}/explain`, {
    path,
    start_line,
    end_line,
    code,
  });
}

/** The selected lines from the checkout the server runs in, or null when there is none or the file is missing. */
function checkoutLines(args: ExplainArgs): string | null {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const lines = readFileSync(join(root, args.path), "utf8").split("\n");

    return lines.slice(args.start_line - 1, args.end_line).join("\n") || null;
  } catch {
    return null;
  }
}

export function renderExplanation({ answer, statements }: Explanation): string {
  if (statements.length === 0) {
    return answer;
  }
  const sources = statements
    .map((statement) => `- ${statement.text} (${statement.via})`)
    .join("\n");

  return `${answer}\n\nSpec statements:\n${sources}`;
}
