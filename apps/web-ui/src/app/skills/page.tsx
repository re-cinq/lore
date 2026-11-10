import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { createSkill, deleteSkill, updateSkill } from "./actions";
import { DeleteSkillButton } from "./DeleteSkillButton";
import { failureMessage } from "./failure-message";
import { SkillForm } from "./SkillForm";
import type { SkillDefinition } from "./skill-definition";

export const dynamic = "force-dynamic";

const READ_TIMEOUT_MS = 5000;

export default async function SkillsPage(props: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await props.searchParams;
  const loaded = await fetchSkills();
  const skills = loaded.status === "ok" ? loaded.skills : [];

  return (
    <div>
      <h1>Skills</h1>
      {loaded.status === "failed" && (
        <p role="alert">Skills could not be loaded: {loaded.message}</p>
      )}
      <SkillsList skills={skills} />
      <SkillEditor skill={skills.find((s) => s.name === edit)} />
    </div>
  );
}

function SkillEditor({ skill }: { skill: SkillDefinition | undefined }) {
  return skill ? (
    <SkillForm
      key={skill.name}
      skill={skill}
      action={updateSkill.bind(null, skill.name)}
    />
  ) : (
    <SkillForm skill={null} action={createSkill} />
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
          <th>Actions</th>
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
        <a href={`?edit=${encodeURIComponent(skill.name)}`}>Edit</a>{" "}
        <DeleteSkillButton action={deleteSkill.bind(null, skill.name)} />
      </td>
    </tr>
  );
}

type LoadedSkills =
  | { status: "ok"; skills: SkillDefinition[] }
  | { status: "failed"; message: string };

async function fetchSkills(): Promise<LoadedSkills> {
  const result = await apiFetch<components["schemas"]["SkillDefinitionsList"]>(
    "lore-api",
    "/api/skill-definitions",
    { timeoutMs: READ_TIMEOUT_MS },
  );

  if (result.status === "ok") {
    return { status: "ok", skills: result.data.skills };
  }

  return { status: "failed", message: failureMessage(result) };
}
