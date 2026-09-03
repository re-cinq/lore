/** A single review comment in the Conventional Comments format (conventionalcomments.org); the review agent emits {@link ReviewFinding}s, the deterministic poster renders each through this class so every Lore review reads the same. */

export type ConventionalLabel =
  "issue" | "suggestion" | "nit" | "question" | "praise" | "thought" | "chore";

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
