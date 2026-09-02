import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Vercel Web-only boundary', () => {
  it('exposes only Owner auth as a Vercel serverless API', () => {
    expect(readdirSync('api').filter(name => name.endsWith('.mjs')).sort()).toEqual(['owner-auth.mjs']);
    for (const retired of ['chief.mjs','chief-smoke.mjs','control.mjs','company-progress.mjs','workforce-status.mjs']) {
      expect(existsSync(`api/${retired}`)).toBe(false);
    }
  });

  it('keeps V3 same-origin calls limited to Owner auth while Controller traffic uses the Tailscale base URL', () => {
    const app = read('public/web-v1/app.js');
    const controller = read('public/web-v1/controller-client.js');
    expect(app).toContain("fetch('/api/owner-auth?action=status'");
    expect(app).toContain("fetch('/api/owner-auth?action=identity'");
    expect(app).not.toMatch(/\/api\/(control|chief|company-progress)/);
    expect(controller).toContain('`${this.baseUrl}${path}`');
    expect(controller).toContain("host.endsWith('.ts.net')");
    expect(controller).toContain("CONTROLLER_NOT_TAILNET_OR_LOCAL");
    expect(controller).toContain("snapshot.source?.mode!=='controller'||snapshot.source?.authoritative!==true");
  });

  it('disables Git auto-deploy and requires explicit manual release approval', () => {
    const config = JSON.parse(read('vercel.json'));
    expect(config.git?.deploymentEnabled).toBe(false);
    const workflow = read('.github/workflows/web-release-vercel.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
    expect(workflow).toContain('WEB_RELEASE_CANDIDATE_APPROVED');
    expect(workflow).toContain('OWNER_APPROVED_PRODUCTION');
    expect(workflow).toContain('release_sha');
  });

  it('contains no active Web/Vercel AI provider call path', () => {
    const active = [read('public/web-v1/app.js'), read('public/web-v1/controller-client.js'), read('api/owner-auth.mjs')].join('\n');
    for (const marker of ['ai-gateway.vercel.sh','api.openai.com','generativelanguage.googleapis.com','AI_GATEWAY_API_KEY','getVercelOidcToken','decideWithChief']) {
      expect(active).not.toContain(marker);
    }
  });
});
