import * as path from "node:path";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import {
  buildLocalIndex,
  buildCoverageIndex,
  mergeIndexes,
  type SpecCodeIndex,
  type SpecSource,
} from "./spec-index.js";
import { specLenses } from "./spec-lenses.js";
import { renderHoverMarkdown } from "./hover.js";
import { LoreClient } from "./lore-client.js";
import { detectRepo, gitConfigGlobal } from "./repo.js";
import type { OpenLocalArgs } from "./command-links.js";

interface State {
  index: SpecCodeIndex;
  show: { implemented: boolean; covered: boolean };
}

const state: State = {
  index: new Map(),
  show: { implemented: true, covered: true },
};

const decImplemented = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: "rgba(65,105,225,0.12)",
  overviewRulerColor: "rgba(65,105,225,0.8)",
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});
const decCovered = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: "rgba(46,160,67,0.10)",
  overviewRulerColor: "rgba(46,160,67,0.8)",
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const lensesChanged = new vscode.EventEmitter<void>();

function workspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

/** Repo-relative, forward-slashed path for an absolute file, or null if outside the root. */
function toRepoRelative(root: string, fsPath: string): string | null {
  const rel = path.relative(root, fsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

function resolveCredentials(): { apiUrl: string; token: string } | null {
  const config = vscode.workspace.getConfiguration("lore");
  const apiUrl =
    config.get<string>("apiUrl")?.trim() || gitConfigGlobal("lore.api-url");
  const token =
    config.get<string>("token")?.trim() || gitConfigGlobal("lore.ingest-token");
  return apiUrl && token ? { apiUrl, token } : null;
}

async function readSpecSources(root: string): Promise<SpecSource[]> {
  const files = await vscode.workspace.findFiles(
    "**/spec.md",
    "**/node_modules/**",
  );
  const sources = await Promise.all(
    files.map(async (uri): Promise<SpecSource | null> => {
      const rel = toRepoRelative(root, uri.fsPath);
      if (!rel) return null;
      try {
        return { path: rel, content: await readFile(uri.fsPath, "utf-8") };
      } catch {
        return null;
      }
    }),
  );
  return sources.filter((s): s is SpecSource => s !== null);
}

async function rebuildIndex(): Promise<void> {
  const root = workspaceRoot();
  if (!root) return;

  const local = buildLocalIndex(await readSpecSources(root));

  let coverage: SpecCodeIndex = new Map();
  const creds = resolveCredentials();
  const repo = detectRepo(root);
  if (creds && repo) {
    try {
      coverage = buildCoverageIndex(
        await new LoreClient(creds.apiUrl, creds.token).graph(repo),
      );
    } catch (err) {
      console.error(
        `[lore] coverage graph fetch failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  state.index = mergeIndexes(local, coverage);
  applyToVisibleEditors();
}

function applyToEditor(editor: vscode.TextEditor): void {
  const root = workspaceRoot();
  if (!root) return;
  const rel = toRepoRelative(root, editor.document.uri.fsPath);
  const entries = rel ? (state.index.get(rel) ?? []) : [];

  const implemented: vscode.DecorationOptions[] = [];
  const covered: vscode.DecorationOptions[] = [];
  for (const entry of entries) {
    const lastLine = editor.document.lineCount - 1;
    const start = Math.min(Math.max(entry.startLine - 1, 0), lastLine);
    const end = Math.min(Math.max(entry.endLine - 1, start), lastLine);
    const hover = new vscode.MarkdownString(renderHoverMarkdown(entry));
    hover.isTrusted = true;
    const option: vscode.DecorationOptions = {
      range: new vscode.Range(start, 0, end, 0),
      hoverMessage: hover,
    };
    (entry.layer === "implemented" ? implemented : covered).push(option);
  }
  editor.setDecorations(
    decImplemented,
    state.show.implemented ? implemented : [],
  );
  editor.setDecorations(decCovered, state.show.covered ? covered : []);
}

function applyToVisibleEditors(): void {
  for (const editor of vscode.window.visibleTextEditors) applyToEditor(editor);
}

const lensProvider: vscode.CodeLensProvider = {
  onDidChangeCodeLenses: lensesChanged.event,
  provideCodeLenses(document) {
    const lastLine = document.lineCount - 1;
    const lenses: vscode.CodeLens[] = [];
    for (const lens of specLenses(document.getText())) {
      const range = document.lineAt(Math.min(lens.line, lastLine)).range;
      for (const target of [...lens.tests, ...lens.code]) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `$(link) ${target.label}`,
            command: "lore.openLocal",
            arguments: [
              {
                path: target.path,
                line: target.line ?? 1,
              } satisfies OpenLocalArgs,
            ],
          }),
        );
      }
    }
    return lenses;
  },
};

async function openLocal(args: OpenLocalArgs): Promise<void> {
  const root = workspaceRoot();
  if (!root) return;
  const uri = vscode.Uri.file(path.join(root, args.path));
  const editor = await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(uri),
  );
  const line = Math.min(
    Math.max(args.line - 1, 0),
    editor.document.lineCount - 1,
  );
  const target = new vscode.Range(line, 0, line, 0);
  editor.selection = new vscode.Selection(target.start, target.start);
  editor.revealRange(target, vscode.TextEditorRevealType.InCenter);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    decImplemented,
    decCovered,
    lensesChanged,
    vscode.commands.registerCommand("lore.openLocal", openLocal),
    vscode.commands.registerCommand("lore.refresh", () => void rebuildIndex()),
    vscode.commands.registerCommand("lore.toggleHighlights", () => {
      const on = state.show.implemented || state.show.covered;
      state.show = { implemented: !on, covered: !on };
      applyToVisibleEditors();
    }),
    vscode.languages.registerCodeLensProvider(
      { scheme: "file", language: "markdown" },
      lensProvider,
    ),
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => editor && applyToEditor(editor),
    ),
    vscode.window.onDidChangeVisibleTextEditors(() => applyToVisibleEditors()),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.endsWith("spec.md")) {
        lensesChanged.fire();
        void rebuildIndex();
      }
    }),
  );

  const config = vscode.workspace.getConfiguration("lore");
  state.show = {
    implemented: config.get<boolean>("highlightImplemented", true),
    covered: config.get<boolean>("highlightCovered", true),
  };

  void rebuildIndex();
}

export function deactivate(): void {
  decImplemented.dispose();
  decCovered.dispose();
}
