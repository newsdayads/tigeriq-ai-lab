import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { autonomyFeedPresentation } from '../api/web-control-status.mjs';

describe('Web Control autonomous operations dashboard', () => {
  it('parses the canonical autonomy feed without fabricating fields', () => {
    const issue = {
      number: 138,
      title: '[P0] [AUTO] ĐANG LÀM — TigerIQ tự xử lý backlog toàn dự án',
      state: 'open',
      updated_at: '2026-09-01T10:20:00Z',
      html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/138',
      body: [
        'TIGERIQ_JOB_V1',
        'TIGERIQ_AUTONOMY_FEED_V1',
        '',
        '## Current Action',
        'Quét backlog.',
        '',
        '## Current Scope',
        'P0 trước.',
        '',
        '## Execution Channel',
        'TigerIQ Autonomous Backlog · GitHub tools · Groq.',
        '',
        '## Last Progress',
        'Đã đóng gate đủ bằng chứng.',
        '',
        '## Next Action',
        'Review gate tiếp theo.',
        '',
        '## Blocker',
        'PC01 cần thiết bị thật.',
        '',
        '## Updated At',
        '2026-09-01T10:22:00Z',
      ].join('\n'),
    };

    expect(autonomyFeedPresentation(issue)).toEqual({
      number: 138,
      title: '[P0] [AUTO] ĐANG LÀM — TigerIQ tự xử lý backlog toàn dự án',
      state: 'open',
      url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/138',
      currentAction: 'Quét backlog.',
      currentScope: 'P0 trước.',
      executionChannel: 'TigerIQ Autonomous Backlog · GitHub tools · Groq.',
      lastProgress: 'Đã đóng gate đủ bằng chứng.',
      nextAction: 'Review gate tiếp theo.',
      blocker: 'PC01 cần thiết bị thật.',
      updatedAt: '2026-09-01T10:22:00Z',
    });
  });

  it('does not treat an ordinary Work Order as the autonomy feed', () => {
    expect(autonomyFeedPresentation({ body: 'TIGERIQ_JOB_V1' })).toBeNull();
  });

  it('makes operations the landing page and never equates an open feed with active execution', async () => {
    const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(config.rewrites).toContainEqual({ source: '/', destination: '/operations.html' });
    expect(config.rewrites).toContainEqual({ source: '/command-center', destination: '/command-center.html' });

    const html = await readFile(new URL('../public/operations.html', import.meta.url), 'utf8');
    expect(html).toContain('Trạng thái điều phối hiện tại');
    expect(html).toContain('AI / kênh thực hiện');
    expect(html).toContain('Vừa hoàn tất');
    expect(html).toContain('Bước tiếp theo');
    expect(html).toContain('Đang chờ / blocker');
    expect(html).toContain('Web runtime');
    expect(html).toContain('function feedState(a)');
    expect(html).toContain("label:'ĐANG CHỜ'");
    expect(html).toContain('Feed điều phối (không phải runtime live)');
    expect(html).not.toContain("active?'ĐANG CHẠY'");
    expect(html).toContain("fetch('/api/web-control-status'");
  });
});
