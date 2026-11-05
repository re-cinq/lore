import * as vscode from "vscode";
import { LoreClient, type ExplainSpan } from "./lore-client.js";
import { ExplainCache, type EntryStore } from "./explain-store.js";
import { ExplainGutter, type LineSpan } from "./explain-gutter.js";
import { detectRepo, toRepoRelative } from "./repo.js";

export interface ExplainContext {
  workspaceRoot(): string | null;
  credentials(): { apiUrl: string; token: string } | null;
  /** Survives a restart, so unchanged code keeps its hint. */
  state: EntryStore;
  extensionUri: vscode.Uri;
}

const REDRAW_AFTER_EDIT_MS = 300;

export function explainSubscriptions(
  context: ExplainContext,
): vscode.Disposable[] {
  const cache = new ExplainCache(context.state);
  const gutter = gutterFor(context, cache);
  let redraw: ReturnType<typeof setTimeout> | undefined;

  gutter.applyVisible();

  return [
    gutter,
    vscode.commands.registerCommand("lore.explainSelection", () =>
      explainSelection(context, cache, gutter),
    ),
    ...lensSubscriptions(gutter),
    vscode.window.onDidChangeVisibleTextEditors(() => gutter.applyVisible()),
    vscode.workspace.onDidChangeTextDocument(() => {
      clearTimeout(redraw);
      redraw = setTimeout(() => gutter.applyVisible(), REDRAW_AFTER_EDIT_MS);
    }),
  ];
}

function gutterFor(
  context: ExplainContext,
  cache: ExplainCache,
): ExplainGutter {
  return new ExplainGutter(context.extensionUri, cache, (document) => {
    const root = context.workspaceRoot();

    return root ? toRepoRelative(root, document.uri.fsPath) : null;
  });
}

/** The CodeLens above each explained span, and the command its click runs. */
function lensSubscriptions(gutter: ExplainGutter): vscode.Disposable[] {
  return [
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      {
        onDidChangeCodeLenses: gutter.changed.event,
        provideCodeLenses: (document) => gutter.lenses(document),
      },
    ),
    vscode.commands.registerCommand("lore.showExplanation", showExplanation),
  ];
}

/** Puts the cursor on the span's first line and opens the hover the hint carries. */
async function showExplanation(uri: vscode.Uri, line: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(uri);
  const position = new vscode.Position(line - 1, 0);

  editor.selection = new vscode.Selection(position, position);
  await vscode.commands.executeCommand("editor.action.showHover");
}

async function explainSelection(
  context: ExplainContext,
  cache: ExplainCache,
  gutter: ExplainGutter,
): Promise<void> {
  const target = explainTarget(context);

  if (!target) {
    void vscode.window.showErrorMessage(
      "Lore: needs a GitHub checkout and the Lore API url and token (git config lore.api-url and lore.ingest-token).",
    );

    return;
  }
  const span = selectedSpan(target.editor, target.root);

  if (!cache.find(span.path, span.code)) {
    await askLore(target, span, { cache, gutter });
  }
  gutter.applyVisible();
}

/** Asks lore-api with a spinner beside the lines, caching the answer; a failure is shown, never swallowed. */
async function askLore(
  { editor, repo, creds }: ExplainTarget,
  span: ExplainSpan,
  { cache, gutter }: { cache: ExplainCache; gutter: ExplainGutter },
): Promise<void> {
  const lines = linesOf(span);

  gutter.startLoading(editor.document, lines);

  try {
    await cache.save(
      span.path,
      span.code,
      await new LoreClient(creds.apiUrl, creds.token).explain(repo, span),
    );
  } catch (err) {
    showFailure(span, err);
  } finally {
    gutter.stopLoading(editor.document, lines);
  }
}

function linesOf({ start_line, end_line }: ExplainSpan): LineSpan {
  return { startLine: start_line, endLine: end_line };
}

function showFailure(span: ExplainSpan, err: unknown): void {
  const reason = err instanceof Error ? err.message : String(err);

  void vscode.window.showErrorMessage(
    `Lore: could not explain ${span.path} lines ${span.start_line}-${span.end_line}: ${reason}`,
  );
}

interface ExplainTarget {
  editor: vscode.TextEditor;
  root: string;
  repo: string;
  creds: { apiUrl: string; token: string };
}

/** Everything the command needs, or null when the window has no editor, checkout or Lore credentials. */
function explainTarget(context: ExplainContext): ExplainTarget | null {
  const editor = vscode.window.activeTextEditor;
  const root = context.workspaceRoot();
  const creds = context.credentials();
  const repo = root ? detectRepo(root) : null;

  if (!editor || !creds) {
    return null;
  }

  return root && repo ? { editor, root, repo, creds } : null;
}

/** The selected lines, widened to whole lines; the cursor's line when nothing is selected. */
function selectedSpan(editor: vscode.TextEditor, root: string): ExplainSpan {
  const { document, selection } = editor;
  const startLine = selection.start.line;
  const endLine =
    selection.end.character === 0 && selection.end.line > startLine
      ? selection.end.line - 1
      : selection.end.line;
  const range = new vscode.Range(
    startLine,
    0,
    endLine,
    document.lineAt(endLine).text.length,
  );

  return {
    path: toRepoRelative(root, document.uri.fsPath) ?? document.uri.fsPath,
    start_line: startLine + 1,
    end_line: endLine + 1,
    code: document.getText(range),
  };
}
