export const dynamic = "force-dynamic";

interface SkillDefinition {
  name: string;
  title: string;
  model: string;
  content: string;
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
  return (
    <tr>
      <td>{skill.name}</td>
      <td>{skill.title}</td>
      <td>{skill.model}</td>
      <td>
        <a href={`/skills/${encodeURIComponent(skill.name)}/edit`}>Edit</a>{" "}
        <button type="button">Delete</button>
      </td>
    </tr>
  );
}

function CreateSkillForm() {
  return (
    <section>
      <h2>New skill</h2>
      <form>
        <SkillField id="skill-name" label="Name" required />
        <SkillField id="skill-title" label="Title" required />
        <SkillField id="skill-model" label="Model" />
        <div>
          <label htmlFor="skill-content">Content (SKILL.md)</label>
          <textarea id="skill-content" name="content" />
        </div>
        <button type="button">Create</button>
      </form>
    </section>
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
    const res = await fetch("/api/skill-definitions", {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {return [];}
    const payload = (await res.json()) as { skills?: SkillDefinition[] };

    return payload.skills ?? [];
  } catch {
    return [];
  }
}
