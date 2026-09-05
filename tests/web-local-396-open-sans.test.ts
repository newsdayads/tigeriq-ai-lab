import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyOpenSansV31, WEB_LOCAL_VERSION_V10 } from '../apps/dashboard/src/server-v10.js';

const sample = '<!doctype html><html><head></head><body><section class="tq322" id="tigeriq-management-v4"></section></body></html>';

describe('Web Local #396 Open Sans final layer', () => {
  it('uses Google Open Sans as the final management typography', () => {
    const html = applyOpenSansV31(sample);
    expect(html).toContain(WEB_LOCAL_VERSION_V10);
    expect(html).toContain('fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap');
    expect(html).toContain('font-family:"Open Sans",ui-sans-serif');
    expect(html).toContain('font:600 11px/1 "Open Sans",ui-sans-serif');
    expect(html).not.toContain('fonts.googleapis.com/css2?family=Inter');
    expect(html).not.toContain('font-family:Inter,ui-sans-serif');
  });

  it('wires standalone runtime evidence to the Open Sans contract', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    expect(standalone).toContain('startOwnerCockpitV10');
    expect(standalone).toContain('fonts.googleapis.com/css2?family=Open+Sans');
    expect(standalone).toContain('open_sans_font_contract=ĐẠT');
    expect(standalone).not.toContain('inter_font_contract=ĐẠT');
  });
});
