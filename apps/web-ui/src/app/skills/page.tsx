import { KNOWN_MODELS } from "@/lib/agents-mirror";
import { SubmitButton } from "@/components/SubmitButton";
import { createSkill, deleteSkill } from "./actions";

export const dynamic = "force-dynamic";

interface SkillDefinition {
  name: string;
  title: string;
  description?: string;
  model: string | null;
  content: string;
  enabled?: boolean;
}

export default async function SkillsPage() {
  const skills = await fetchSkills();

  return (
    <div>
      <h1>Skills</h1>
      <SkillsList skills={skills} />
      <CreateSkillForm />
    </div>
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
  const deleteAction = deleteSkill.bind(null, skill.name);

  return (
    <tr>
      <td>{skill.name}</td>
      <td>{skill.title}</td>
      <td>{skill.model ?? "(Inherit)"}</td>
      <td>
        <a href={`?edit=${encodeURIComponent(skill.name)}`}>Edit</a>{" "}
        <form action={deleteAction}>
          <SubmitButton>Delete</SubmitButton>
        </form>
      </td>
    </tr>
  );
}

function CreateSkillForm() {
  return (
    <section>
      <h2>New skill</h2>
      <form action={createSkill}>
        <SkillField id="skill-name" label="Name" required />
        <SkillField id="skill-title" label="Title" required />
        <SkillField id="skill-description" label="Description" />
        <SkillModelSelect />
        <SkillContentTextarea />
        <SkillEnabledCheckbox />
        <SubmitButton>Create</SubmitButton>
      </form>
    </section>
  );
}

function SkillModelSelect() {
  return (
    <div>
      <label htmlFor="skill-model">Model</label>
      <select id="skill-model" name="model">
        <option value="">(Inherit)</option>
        {KNOWN_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SkillContentTextarea() {
  return (
    <div>
      <label htmlFor="skill-content">Content (SKILL.md)</label>
      <textarea id="skill-content" name="content" />
    </div>
  );
}

function SkillEnabledCheckbox() {
  return (
    <div>
      <label htmlFor="skill-enabled">Enabled</label>
      <input id="skill-enabled" name="enabled" type="checkbox" defaultChecked />
    </div>
  );
}

function SkillField({
  id,
  label,
  required,
}: {
  id: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id.slice(6)} type="text" required={required} />
    </div>
  );
}

async function fetchSkills(): Promise<SkillDefinition[]> {
  try {
    const { url, tk } = getApiConfig();
    const res = await fetch(`${url}/api/skill-definitions`, {
      signal: AbortSignal.timeout(5000),
      headers: tk ? { authorization: `Bearer ${tk}` } : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      return [];
    }
    const payload = (await res.json()) as { skills?: SkillDefinition[] };

    return payload.skills || [];
  } catch {
    return [];
  }
}

function getApiConfig() {
  const tk = process.env.LORE_ADMIN_TOKEN || process.env.LORE_INGEST_TOKEN;

  return { url: process.env.LORE_API_URL || "", tk };
}
