import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Web Control V1 operations entry', () => {
  it('uses the Controller-backed Web V1 bundle as the operations landing page', async () => {
    const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(config.rewrites).toContainEqual({ source: '/', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/operations', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/command-center', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/workforce', destination: '/web-v1/index.html' });

    const html = await readFile(new URL('../public/web-v1/index.html', import.meta.url), 'utf8');
    expect(html).toContain('Web Control V1');
    expect(html).toContain('Workforce Controller');
    expect(html).toContain('MOCK MODE');
    expect(html).toContain('Prompt Architect');
    expect(html).toContain('Result & Evidence');
  });

  it('does not use the old GitHub autonomy feed as runtime truth', async () => {
    const app = await readFile(new URL('../public/web-v1/app.js', import.meta.url), 'utf8');
    expect(app).not.toContain('TIGERIQ_AUTONOMY_FEED_V1');
    expect(app).not.toContain('/api/web-control-status');
    expect(app).not.toContain('api.github.com');
    expect(app).toContain("state.mode === 'controller'");
  });
});
