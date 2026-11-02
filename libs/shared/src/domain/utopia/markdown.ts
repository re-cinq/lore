// The markdown a Utopia Library shows for one mirrored record: its title as the heading, its fields as a bold-labelled list, then its message whole.

export type Field = [label: string, value: string];

export function markdownDocument(
  title: string,
  fields: Field[],
  message: string,
): string {
  const list = fields.map(([label, value]) => `- **${label}:** ${value}`);

  return [`# ${title}`, list.join("\n"), message]
    .filter((part) => part !== "")
    .join("\n\n");
}
