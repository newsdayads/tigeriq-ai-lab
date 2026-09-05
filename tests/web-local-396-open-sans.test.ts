import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyOpenSansV31, WEB_LOCAL_VERSION_V10 } from '../apps/dashboard/src/server-v10.js';

const sample = '<!doctype html><html><head></head><body><section class="tq322" id="tigeriq-management-v4"></section></body></html>';

describe('Web Local #396 historical Open Sans layer', () => {
  it('retains historical V10 behavior for provenance only', () => {
    const html = applyOpenSansV31(sample);
    expect(html).toContain(WEB_LOCAL_VERSION_V10);
    expect(html).toContain('fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap');
    expect(html).toContain('font-family:"Open Sans",ui-sans-serif');
  });

  it('does not expose Open Sans as the current final runtime contract', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    expect(standalone).toContain('startOwnerCockpitV12');
    expect(standalone).toContain('segoe_ui_font_contract=ĐẠT');
    expect(standalone).toContain('google_font_removed=ĐẠT');
    expect(standalone).not.toContain('open_sans_font_contract=ĐẠT');
    expect(standalone).not.toContain('open_sans_whole_site=ĐẠT');
  });
});