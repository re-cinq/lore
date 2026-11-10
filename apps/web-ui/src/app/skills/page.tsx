import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/Alert";
import { deleteSkill } from "./actions";
import { DeleteSkillButton } from "./DeleteSkillButton";
import { fetchSkills, type LoadedSkills } from "@/lib/fetch-skills";
import type { SkillDefinition } from "@/lib/skill-definition";
import styles from "./skills.module.css";

export const dynamic = "force-dynamic";

export default async function SkillsPage(props: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await props.searchParams;

  if (edit) {
    redirect(`/skills/${encodeURIComponent(edit)}`);
  }

  return (
    <div>
      <h1>Skills</h1>
      <p>
        <Link href="/skills/new">Add skill</Link>
      </p>
      <LoadedSkillsList loaded={await fetchSkills()} />
    </div>
  );
}

function LoadedSkillsList({ loaded }: { loaded: LoadedSkills }) {
  return loaded.status === "failed" ? (
    <Alert>Skills could not be loaded: {loaded.message}</Alert>
  ) : (
    <SkillsList skills={loaded.skills} />
  );
}

function SkillsList({ skills }: { skills: SkillDefinition[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Title</th>
          <th>Model</th>
          <th>Edit</th>
          <th className={styles.dangerCell}>Delete</th>
        </tr>
      </thead>
      <tbody>
        {skills.map((skill) => (
          <SkillRow key={skill.name} skill={skill} />
        ))}
      </tbody>
    </table>
  );
}

function SkillRow({ skill }: { skill: SkillDefinition }) {
  return (
    <tr>
      <td>{skill.name}</td>
      <td>{skill.title}</td>
      <td>{skill.model ?? "(Inherit)"}</td>
      <td>
        <Link href={`/skills/${encodeURIComponent(skill.name)}`}>Edit</Link>
      </td>
      <td className={styles.dangerCell}>
        <DeleteSkillButton
          name={skill.name}
          remove={deleteSkill.bind(null, skill.name)}
        />
      </td>
    </tr>
  );
}
