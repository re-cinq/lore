import SpecDetails, { type StatementInfo } from "../SpecDetails";
import { splitMarkdownSections } from "@/lib/markdown-sections";
import styles from "./SpecDocument.module.css";

interface SpecDocumentProps {
  repo: string;
  content: string;
  statements: StatementInfo[];
}

export default function SpecDocument({
  repo,
  content,
  statements,
}: SpecDocumentProps) {
  const sections = splitMarkdownSections(content);

  return (
    <>
      {sections.map((section, index) => (
        <section key={index} data-doc-section className={styles.section}>
          <SpecDetails
            repo={repo}
            content={section.body}
            statements={statements}
          />
        </section>
      ))}
    </>
  );
}
