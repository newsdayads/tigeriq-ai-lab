import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Live Autonomy Demo Evidence', () => {
  const filePath = path.resolve(process.cwd(), 'docs/evidence/LIVE-AUTONOMY-DEMO-20260912.md');

  it('should exist and contain the exact expected lines', () => {
    // 1. The file exists.
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    // Normalize line endings to support cross-platform (CRLF vs LF)
    const lines = content.replace(/\r\n/g, '\n').trim().split('\n');

    expect(lines.length).toBe(3);

    // 2. The first line matches the title.
    expect(lines[0]).toBe('# Live Autonomy Demo 2026-09-12');

    // 3. The second line matches the purpose sentence.
    expect(lines[1]).toBe('Muc tieu: chung minh he thong tu nhan viec va code qua Coding Lane.');

    // 4. The third line matches the marker.
    expect(lines[2]).toBe('Marker: LIVE_AUTONOMY_DEMO_20260912');
  });
});
