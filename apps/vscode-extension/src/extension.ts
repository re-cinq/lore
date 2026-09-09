import * as path from "node:path";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import {
  buildLocalIndex,
  buildCoverageIndex,
  mergeIndexes,
  type LinkTarget,
  type RangeEntry,
  type SpecCodeIndex,
  type SpecSource,
} from "./spec-index.js";
import { specLenses } from "./spec-lenses.js";
import { renderHoverMarkdown } from "./hover.js";
import { LoreClient } from "./lore-client.js";
import { detectRepo, gitConfigGlobal } from "./repo.js";
import type { OpenLocalArgs } from "./command-links.js";
import {
  resolveCredentialField,
  decorationRange,
  entriesForPath,
  partitionByLayer,
} from "./decoration-math.js";

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

export function activate(context: vscode.ExtensionContext): void {
  registerSubscriptions(context);

  const config = vscode.workspace.getConfiguration("lore");

  state.show = {
    implemented: config.get<boolean>("highlightImplemented", true), // eslint-disable-line re-lint/no-flag-params -- VS Code config.get fallback-value signature, not a behaviour switch
    covered: config.get<boolean>("highlightCovered", true), // eslint-disable-line re-lint/no-flag-params -- VS Code config.get fallback-value signature, not a behaviour switch
  };

  void rebuildIndex();
}

export function deactivate(): void {
  decImplemented.dispose();
  decCovered.dispose();
}

/** Everything the extension owns for the window's lifetime. Pushed onto `context.subscriptions` so VS Code disposes them on deactivate — a listener left registered would keep firing against a dead index. */
function registerSubscriptions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    decImplemented,
    decCovered,
    lensesChanged,
    ...commandSubscriptions(),
    ...editorSubscriptions(),
  );
}

// What the reader can invoke. `toggleHighlights` reads the CURRENT state to decide the next one, so turning either kind on turns both on — one control, one meaning.
function commandSubscriptions(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("lore.openLocal", openLocal),
    vscode.commands.registerCommand("lore.refresh", () => void rebuildIndex()),
    vscode.commands.registerCommand("lore.toggleHighlights", () => {
      const on = state.show.implemented || state.show.covered;

      state.show = { implemented: !on, covered: !on };
      applyToVisibleEditors();
    }),
  ];
}

async function openLocal(args: OpenLocalArgs): Promise<void> {
  const root = workspaceRoot();

  if (!root) {
    return;
  }
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

const lensesChanged = new vscode.EventEmitter<void>();

const lensProvider: vscode.CodeLensProvider = {
  onDidChangeCodeLenses: lensesChanged.event,
  provideCodeLenses(document) {
    const lastLine = document.lineCount - 1;
    const lenses: vscode.CodeLens[] = [];

    for (const lens of specLenses(document.getText())) {
      const range = document.lineAt(Math.min(lens.line, lastLine)).range;

      lenses.push(...linkLenses(range, [...lens.tests, ...lens.code]));
    }

    return lenses;
  },
};

function linkLenses(
  range: vscode.Range,
  targets: LinkTarget[],
): vscode.CodeLens[] {
  return targets.map(
    (target) =>
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

// What the editor tells us. Saving a `spec.md` rebuilds the index because the file that just changed is the one the highlights are derived from; any other save is none of our business.
function editorSubscriptions(): vscode.Disposable[] {
  return [
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
  ];
}

async function rebuildIndex(): Promise<void> {
  const root = workspaceRoot();

  if (!root) {
    return;
  }

  const local = buildLocalIndex(await readSpecSources(root));

  state.index = mergeIndexes(local, await readCoverageIndex(root));
  applyToVisibleEditors();
}

function applyToVisibleEditors(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    applyToEditor(editor);
  }
}

function applyToEditor(editor: vscode.TextEditor): void {
  const root = workspaceRoot();

  if (!root) {
    return;
  }
  const { document } = editor;
  const rel = toRepoRelative(root, document.uri.fsPath);
  const entries = entriesForPath(state.index, rel);
  const lastLine = document.lineCount - 1;
  const { implemented, covered } = partitionByLayer(entries);

  editor.setDecorations(
    decImplemented,
    state.show.implemented ? toDecorationOptions(implemented, lastLine) : [],
  );
  editor.setDecorations(
    decCovered,
    state.show.covered ? toDecorationOptions(covered, lastLine) : [],
  );
}

function toDecorationOptions(
  entries: RangeEntry[],
  lastLine: number,
): vscode.DecorationOptions[] {
  return entries.map((entry) => {
    const { start, end } = decorationRange(entry, lastLine);
    const hover = new vscode.MarkdownString(renderHoverMarkdown(entry));

    hover.isTrusted = true;

    return { range: new vscode.Range(start, 0, end, 0), hoverMessage: hover };
  });
}

async function readSpecSources(root: string): Promise<SpecSource[]> {
  const files = await vscode.workspace.findFiles(
    "**/spec.md",
    "**/node_modules/**",
  );
  const sources = await Promise.all(
    files.map(async (uri): Promise<SpecSource | null> => {
      const rel = toRepoRelative(root, uri.fsPath);

      if (!rel) {
        return null;
      }

      try {
        return { path: rel, content: await readFile(uri.fsPath, "utf-8") };
      } catch {
        return null;
      }
    }),
  );

  return sources.filter((s): s is SpecSource => s !== null);
}

// The coverage half of the index, or an empty one. Every reason it can be missing — no credentials, no detectable repo, an unreachable API — leaves the LOCAL index intact: highlighting what the workspace itself knows is still useful offline, so a failure here is logged rather than surfaced.
async function readCoverageIndex(root: string): Promise<SpecCodeIndex> {
  const creds = resolveCredentials();
  const repo = detectRepo(root);

  if (!creds || !repo) {
    return new Map();
  }

  try {
    return buildCoverageIndex(
      await new LoreClient(creds.apiUrl, creds.token).graph(repo),
    );
  } catch (err) {
    console.error(
      `[lore] coverage graph fetch failed: ${err instanceof Error ? err.message : err}`,
    );

    return new Map();
  }
}

function resolveCredentials(): { apiUrl: string; token: string } | null {
  const config = vscode.workspace.getConfiguration("lore");
  const apiUrl = resolveCredentialField(
    config.get<string>("apiUrl"),
    gitConfigGlobal("lore.api-url"),
  );
  const token = resolveCredentialField(
    config.get<string>("token"),
    gitConfigGlobal("lore.ingest-token"),
  );

  return apiUrl && token ? { apiUrl, token } : null;
}

/** Repo-relative, forward-slashed path for an absolute file, or null if outside the root. */
function toRepoRelative(root: string, fsPath: string): string | null {
  const rel = path.relative(root, fsPath);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }

  return rel.split(path.sep).join("/");
}

function workspaceRoot(): string | null {
  const { workspaceFolders } = vscode.workspace;
  const folder: vscode.WorkspaceFolder | undefined = workspaceFolders?.[0];

  return folder?.uri.fsPath ?? null;
}
