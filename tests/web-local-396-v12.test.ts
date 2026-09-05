import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySegoeUiDefault, WEB_LOCAL_VERSION_V12 } from '../apps/dashboard/src/server-v12.js';

const sample = `<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap"><style>:root{font-family:"Open Sans",ui-sans-serif} .x{font-family:Inter,ui-sans-serif}</style></head><body><section data-version="WEB-LOCAL-396-V3.2">Hello</section></body></html>`;

describe('Web Local #396 UI V3.3 Segoe UI layer', () => {
  it('removes Google Fonts and forces Segoe UI site-wide', () => {
    const html = applySegoeUiDefault(sample);
    expect(html).toContain(WEB_LOCAL_VERSION_V12);
    expect(html).toContain('data-font="segoe-ui-default"');
    expect(html).toContain('font-family:"Segoe UI",Arial,sans-serif!important');
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('retains Segoe UI as the font contract while V3.4 is the current visual runtime', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-396-V3.4', 'startOwnerCockpitV12', 'startOwnerCockpitV13', 'segoe_ui_font_contract=ĐẠT',
      'segoe_ui_whole_site=ĐẠT', 'google_font_removed=ĐẠT', 'fluent_executive_visual_contract=ĐẠT',
      'state=WEB_LOCAL_396_V34_FLUENT_EXECUTIVE_VERIFIED',
    ]) expect(standalone).toContain(expected);
    expect(standalone).not.toContain('open_sans_font_contract=ĐẠT');
    expect(standalone).not.toContain('open_sans_whole_site=ĐẠT');
  });
});