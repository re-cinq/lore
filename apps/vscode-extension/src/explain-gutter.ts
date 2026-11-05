import * as vscode from "vscode";
import { explanationMarkdown, lensTitle } from "./explain-view.js";
import {
  isGrounded,
  placeEntries,
  type ExplainCache,
  type PlacedEntry,
} from "./explain-store.js";

/** 1-based inclusive lines of one document. */
export interface LineSpan {
  startLine: number;
  endLine: number;
}

/** The icons beside explained code: a spinner while the answer is on its way, then a hint whose hover shows it, dimmed for "I don't know". */
export class ExplainGutter implements vscode.Disposable {
  private readonly loadingType: vscode.TextEditorDecorationType;
  private readonly hintType: vscode.TextEditorDecorationType;
  private readonly unknownType: vscode.TextEditorDecorationType;
  private readonly spanType = vscode.window.createTextEditorDecorationType({});
  private readonly loading = new Map<string, LineSpan[]>();
  /** Fires on every redraw, so the CodeLenses follow the hints. */
  readonly changed = new vscode.EventEmitter<void>();

  constructor(
    extensionUri: vscode.Uri,
    private readonly cache: ExplainCache,
    private readonly relativePath: (
      document: vscode.TextDocument,
    ) => string | null,
  ) {
    const icon = (name: string) =>
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", name),
        gutterIconSize: "contain",
      });

    this.loadingType = icon("explain-loading.svg");
    this.hintType = icon("explain-hint.svg");
    this.unknownType = icon("explain-unknown.svg");
  }

  startLoading(document: vscode.TextDocument, span: LineSpan): void {
    const key = document.uri.toString();

    this.loading.set(key, [...(this.loading.get(key) ?? []), span]);
    this.applyVisible();
  }

  stopLoading(document: vscode.TextDocument, span: LineSpan): void {
    const key = document.uri.toString();
    const rest = (this.loading.get(key) ?? []).filter(
      (other) => other !== span,
    );

    this.loading.set(key, rest);
    this.applyVisible();
  }

  applyVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.apply(editor);
    }
    this.changed.fire();
  }

  /** One CodeLens per explained span; the gutter icon itself can take no click, so this is the click target. */
  lenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return this.placedIn(document).map(
      (placed) =>
        new vscode.CodeLens(firstLine(placed), {
          title: lensTitle(placed.entry.explanation),
          command: "lore.showExplanation",
          arguments: [document.uri, placed.startLine],
        }),
    );
  }

  dispose(): void {
    this.changed.dispose();

    for (const type of [
      this.loadingType,
      this.hintType,
      this.unknownType,
      this.spanType,
    ]) {
      type.dispose();
    }
  }

  private apply(editor: vscode.TextEditor): void {
    const { document } = editor;
    const placed = this.placedIn(document);
    const loading = this.loading.get(document.uri.toString()) ?? [];

    editor.setDecorations(this.loadingType, loading.map(firstLine));
    editor.setDecorations(
      this.hintType,
      placed.filter(({ entry }) => isGrounded(entry)).map(iconOn),
    );
    editor.setDecorations(
      this.unknownType,
      placed.filter(({ entry }) => !isGrounded(entry)).map(iconOn),
    );
    editor.setDecorations(this.spanType, placed.flatMap(restOfSpan));
  }

  /** The cached answers whose code is in the document as it reads now. */
  private placedIn(document: vscode.TextDocument): PlacedEntry[] {
    const rel = this.relativePath(document);

    return rel
      ? placeEntries(this.cache.entriesFor(rel), document.getText())
      : [];
  }
}

function firstLine({ startLine }: LineSpan): vscode.Range {
  return new vscode.Range(startLine - 1, 0, startLine - 1, 0);
}

/** The icon on the span's first line, its hover over that whole line's text. */
function iconOn(placed: PlacedEntry): vscode.DecorationOptions {
  const line = placed.startLine - 1;

  return {
    range: new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
    hoverMessage: hoverOf(placed),
  };
}

/** The same hover on the span's other lines, without a second icon. */
function restOfSpan(placed: PlacedEntry): vscode.DecorationOptions[] {
  if (placed.endLine <= placed.startLine) {
    return [];
  }
  const range = new vscode.Range(
    placed.startLine,
    0,
    placed.endLine - 1,
    Number.MAX_SAFE_INTEGER,
  );

  return [{ range, hoverMessage: hoverOf(placed) }];
}

function hoverOf(placed: PlacedEntry): vscode.MarkdownString {
  return new vscode.MarkdownString(
    explanationMarkdown(placed.entry.explanation),
  );
}
