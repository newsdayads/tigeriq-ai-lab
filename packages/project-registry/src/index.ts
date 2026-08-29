export type ProjectEnvironmentState = 'ready' | 'error' | 'unknown';

export interface ProjectEnvironment {
  name: 'production' | 'test' | 'preview';
  branch: string;
  commitSha: string;
  state: ProjectEnvironmentState;
  deploymentId?: string;
  url?: string;
}

export interface ExternalProjectSnapshot {
  id: string;
  name: string;
  repository: string;
  mainBranch: string;
  mainSha: string;
  environments: readonly ProjectEnvironment[];
  observedAt: string;
  mode: 'read-only' | 'managed';
}

export interface ProjectHealth {
  id: string;
  name: string;
  productionAligned: boolean;
  productionReady: boolean;
  testReady: boolean;
  drift: string[];
}

export class ProjectRegistry {
  readonly #projects = new Map<string, ExternalProjectSnapshot>();

  register(snapshot: ExternalProjectSnapshot): void {
    validate(snapshot);
    this.#projects.set(snapshot.id, structuredClone(snapshot));
  }

  get(id: string): ExternalProjectSnapshot {
    const snapshot = this.#projects.get(id);
    if (!snapshot) throw new Error(`project ${id} not found`);
    return structuredClone(snapshot);
  }

  list(): ExternalProjectSnapshot[] {
    return [...this.#projects.values()].map((snapshot) => structuredClone(snapshot));
  }

  health(id: string): ProjectHealth {
    const project = this.get(id);
    const production = project.environments.find((environment) => environment.name === 'production');
    const test = project.environments.find((environment) => environment.name === 'test');
    const drift: string[] = [];
    if (!production) drift.push('production environment missing');
    else {
      if (production.commitSha !== project.mainSha) drift.push('production commit differs from MAIN');
      if (production.state !== 'ready') drift.push(`production state is ${production.state}`);
    }
    if (test && test.state !== 'ready') drift.push(`test state is ${test.state}`);
    return {
      id: project.id,
      name: project.name,
      productionAligned: Boolean(production && production.commitSha === project.mainSha),
      productionReady: Boolean(production && production.state === 'ready'),
      testReady: Boolean(test && test.state === 'ready'),
      drift,
    };
  }
}

function validate(snapshot: ExternalProjectSnapshot): void {
  if (!snapshot.id.trim() || !snapshot.name.trim() || !snapshot.repository.trim()) throw new Error('project identity is required');
  if (!snapshot.mainBranch.trim() || !snapshot.mainSha.trim()) throw new Error('main branch and sha are required');
  if (!Number.isFinite(Date.parse(snapshot.observedAt))) throw new Error('observedAt must be an ISO timestamp');
  const seen = new Set<string>();
  for (const environment of snapshot.environments) {
    if (seen.has(environment.name)) throw new Error(`duplicate environment ${environment.name}`);
    seen.add(environment.name);
    if (!environment.branch.trim() || !environment.commitSha.trim()) throw new Error('environment branch and sha are required');
  }
}
