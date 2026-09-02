import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Company Control Tower operations entry', () => {
  it('uses Company Control Tower as every legacy Web landing path', async () => {
    const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(config.rewrites).toContainEqual({ source: '/', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/operations', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/command-center', destination: '/web-v1/index.html' });
    expect(config.rewrites).toContainEqual({ source: '/workforce', destination: '/web-v1/index.html' });
    const html = await readFile(new URL('../public/web-v1/index.html', import.meta.url), 'utf8');
    expect(html).toContain('COMPANY CONTROL TOWER');
    expect(html).toContain('MỤC TIÊU QUAN TRỌNG NHẤT');
    expect(html).toContain('CẦN SẾP');
    expect(html).toContain('Vận hành kỹ thuật');
    expect(html).not.toContain('Nhập tin nhắn');
    expect(html).not.toContain('Chat với TigerIQ');
  });

  it('does not use GitHub/Vercel as runtime or business truth', async () => {
    const app = await readFile(new URL('../public/web-v1/app.js', import.meta.url), 'utf8');
    const adapter = await readFile(new URL('../public/web-v1/company-control-tower-adapter.js', import.meta.url), 'utf8');
    expect(app).not.toContain('TIGERIQ_AUTONOMY_FEED_V1');
    expect(app).not.toContain('/api/web-control-status');
    expect(app).not.toContain('api.github.com');
    expect(app).toContain("state.mode === 'controller'");
    expect(adapter).toContain('BUSINESS_CONTRACT_PENDING');
  });
});
