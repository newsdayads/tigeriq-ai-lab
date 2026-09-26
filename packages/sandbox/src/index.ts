export interface SandboxPolicy {
  network: 'deny-by-default' | 'allowlist';
  productionSecrets: false;
  maxExecutionMinutes: number;
  commandAllowlist: string[];
}

export const defaultSandboxPolicy: SandboxPolicy = {
  network: 'allowlist',
  productionSecrets: false,
  maxExecutionMinutes: 30,
  commandAllowlist: ['node', 'npm', 'npx', 'git', 'tsc', 'vitest', 'playwright']
};
