import * as path from "node:path";
import * as vscode from "vscode";
import { LoreClient, type ExplainSpan } from "./lore-client.js";
import { explanationMarkdown } from "./explain-view.js";
import { detectRepo } from "./repo.js";

/** Serves each explanation as a read-only markdown document, so its preview closes without a save prompt. */
const EXPLAIN_SCHEME = "lore-explain";
const pages = new Map<string, string>();
const pageChanged = new vscode.EventEmitter<vscode.Uri>();
const pageProvider: vscode.TextDocumentContentProvider = {
  onDidChange: pageChanged.event,
  provideTextDocumentContent: (uri) => pages.get(uri.toString()) ?? "",
};

export interface ExplainContext {
  workspaceRoot(): string | null;
  credentials(): { apiUrl: string; token: string } | null;
}

export function explainSubscriptions(
  context: ExplainContext,
): vscode.Disposable[] {
  return [
    pageChanged,
    vscode.workspace.registerTextDocumentContentProvider(
      EXPLAIN_SCHEME,
      pageProvider,
    ),
    vscode.commands.registerCommand("lore.explainSelection", () =>
      explainSelection(context),
    ),
  ];
}

async function explainSelection(context: ExplainContext): Promise<void> {
  const target = explainTarget(context);

  if (!target) {
    void vscode.window.showErrorMessage(
      "Lore: needs a GitHub checkout and the Lore API url and token (git config lore.api-url and lore.ingest-token).",
    );

    return;
  }
  const { editor, root, repo, creds } = target;
  const span = selectedSpan(editor, root);
  const explanation = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Lore: reading the specs for this code ...",
    },
    () => new LoreClient(creds.apiUrl, creds.token).explain(repo, span),
  );

  await showPage(span, explanationMarkdown(span, explanation));
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
    path: path.relative(root, document.uri.fsPath).split(path.sep).join("/"),
    start_line: startLine + 1,
    end_line: endLine + 1,
    code: document.getText(range),
  };
}

async function showPage(span: ExplainSpan, markdown: string): Promise<void> {
  const uri = vscode.Uri.from({
    scheme: EXPLAIN_SCHEME,
    path: `/${span.path} lines ${span.start_line}-${span.end_line}.md`,
  });

  pages.set(uri.toString(), markdown);
  pageChanged.fire(uri);
  await vscode.commands.executeCommand("markdown.showPreviewToSide", uri);
}
