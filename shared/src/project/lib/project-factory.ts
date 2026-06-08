import type { PgPool, DgraphClientPort } from "../../memory-store.js";
import { Project } from "./project.js";

/**
 * Build a Project from a repo fullName and the two database connections. The
 * Project initializes every port itself (lazily) — callers never instantiate an
 * adapter. env defaults to process.env for the trust gates and ambient auth.
 */
export function createProject(
  fullName: string,
  pgPool: PgPool,
  dgraphClient: DgraphClientPort,
  env?: NodeJS.ProcessEnv,
): Project {
  return new Project(fullName, pgPool, dgraphClient, env);
}

let registeredProject: Project | null = null;

export function setProject(project: Project): void {
  registeredProject = project;
}

export function project(): Project {
  if (!registeredProject) {
    throw new Error("No Project registered — call setProject() during boot");
  }
  return registeredProject;
}
