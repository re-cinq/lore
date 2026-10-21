export interface SkillDef {
  name: string;
  title: string;
  description: string | null;
  model: string | null;
  content: string;
  enabled: boolean;
  project_id: string | null;
}

export interface SkillDefsReadPort {
  resolve(repo: string, name: string): Promise<SkillDef | null>;
}
