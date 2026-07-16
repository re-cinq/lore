/**
 * A single review comment in the Conventional Comments format
 * (https://conventionalcomments.org) — a scannable, no-emoji label the reader
 * can follow down the left margin, an optional decoration, a one-line subject,
 * optional discussion, and an optional GitHub ` ```suggestion ` block that a
 * human can apply in one click.
 *
 * The review agent emits structured {@link ReviewFinding}s; the deterministic
 * poster renders each one through this class so every Lore review reads the same.
 */

export type ConventionalLabel =
  | "issue"
  | "suggestion"
  | "nit"
  | "question"
  | "praise"
  | "thought"
  | "chore";

export type ConventionalDecoration = "blocking" | "non-blocking" | "if-minor";

export interface ConventionalCommentParts {
  label: ConventionalLabel;
  decoration?: ConventionalDecoration;
  subject: string;
  discussion?: string;
  suggestion?: string;
}

export class ConventionalComment {
  constructor(private readonly parts: ConventionalCommentParts) {}

  render(): string {
    const { label, decoration, subject, discussion, suggestion } = this.parts;
    const header = `**${label}${decoration ? ` (${decoration})` : ""}:** ${subject.trim()}`;
    const blocks = [header];

    if (discussion?.trim()) {
      blocks.push(discussion.trim());
    }
    if (suggestion !== undefined) {
      blocks.push(`\`\`\`suggestion\n${suggestion}\n\`\`\``);
    }

    return blocks.join("\n\n");
  }
}
