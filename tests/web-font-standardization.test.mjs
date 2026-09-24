import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const htmlSurfaces = [
  'command-center.html',
  'public/command-center.html',
  'public/workforce.html',
  'apps/tigeriq-core/dashboard.html',
  'apps/tigeriq-core/web-control.html',
  'apps/chrome-controller/public/index.html',
  'index.html',
  'src/command-center-web-control/index.html',
];

const weightSurfaces = [
  ...htmlSurfaces,
  'apps/tigeriq-core/web-control-mobile.css',
  'apps/tigeriq-core/web-control-routing.css',
  'apps/tigeriq-core/web-control-unified.css',
  'apps/tigeriq-core/web-control-workforce.css',
];

describe('web typography baseline', () => {
  it('loads and prefers Roboto Flex on every website surface', () => {
    for (const path of htmlSurfaces) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toContain('fonts.googleapis.com/css2?family=Roboto+Flex');
      expect(source, path).toContain('Roboto Flex');
    }
  });

  it('does not use synthetic ultra-heavy web weights', () => {
    for (const path of weightSurfaces) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/font-weight:(?:850|900|950)\b/);
    }
  });

  it('allows Google Fonts through the Vercel CSP', () => {
    const config = readFileSync('vercel.json', 'utf8');
    expect(config).toContain('https://fonts.googleapis.com');
    expect(config).toContain("font-src 'self' https://fonts.gstatic.com");
  });

  it('keeps the TigerIQ Live root/public mirrors identical', () => {
    expect(readFileSync('command-center.html', 'utf8')).toBe(readFileSync('public/command-center.html', 'utf8'));
  });
});
